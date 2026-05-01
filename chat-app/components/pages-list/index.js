import { ref, computed, toRef, watchEffect } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

export default {
  props: {
    chatId: { type: String, required: true },
    chatTitle: { type: String, default: "" },
  },
  emits: ["close"],
  setup(props, { emit }) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter();
    const chatIdRef = toRef(props, "chatId");

    const searchQuery = ref("");
    const showCreateForm = ref(false);
    const newPageTitle = ref("");
    const selectedMembers = ref(new Set());
    const isCreatingPage = ref(false);

    // Discover pages for this chat from the user's page inbox
    const { objects: pageObjects, isFirstPoll: arePagesLoading } =
      useGraffitiDiscover(
        computed(() =>
          session.value?.actor
            ? [`${session.value.actor}/page-inbox`]
            : [],
        ),
        {
          properties: {
            value: {
              required: [
                "activity",
                "type",
                "title",
                "channel",
                "parentChatId",
                "published",
              ],
              properties: {
                activity: { const: "Create" },
                type: { const: "Page" },
                title: { type: "string" },
                channel: { type: "string" },
                parentChatId: { type: "string" },
                published: { type: "number" },
              },
            },
          },
        },
        undefined,
        true,
      );

    // Only pages belonging to this chat
    const chatPages = computed(() =>
      pageObjects.value.filter(
        (p) => p.value.parentChatId === chatIdRef.value,
      ),
    );

    // Discover messages for all pages in this chat
    const pageChannels = computed(() =>
      chatPages.value.map((p) => p.value.channel),
    );

    const { objects: pageMessageObjects } = useGraffitiDiscover(
      pageChannels,
      {
        properties: {
          value: {
            required: ["activity", "type", "content", "published"],
            properties: {
              activity: { const: "Create" },
              type: { const: "Message" },
              content: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
    );

    // Discover parent chat members
    const { objects: memberObjects } = useGraffitiDiscover(
      computed(() => [`${chatIdRef.value}/members`]),
      {
        properties: {
          value: {
            required: ["activity", "type", "member"],
            properties: {
              activity: { const: "Add" },
              type: { const: "Member" },
              member: { type: "string" },
            },
          },
        },
      },
    );

    const memberActors = computed(() => [
      ...new Set(memberObjects.value.map((o) => o.value.member)),
    ]);

    // Discover profiles for all actors (page members + message senders)
    const allActors = computed(() => {
      const actors = new Set(memberActors.value);
      for (const page of chatPages.value) {
        (page.value.members || []).forEach((a) => actors.add(a));
      }
      for (const m of pageMessageObjects.value) {
        actors.add(m.actor);
      }
      return [...actors];
    });

    const { objects: profileObjects } = useGraffitiDiscover(
      computed(() => allActors.value.map((a) => `${a}/profile`)),
      {
        properties: {
          value: {
            required: ["activity", "type"],
            properties: {
              activity: { const: "Update" },
              type: { const: "Profile" },
            },
          },
        },
      },
    );

    const actorHandles = ref({});
    async function resolveHandle(actor) {
      if (actorHandles.value[actor] !== undefined) return;
      actorHandles.value[actor] = null;
      try {
        const handle = await graffiti.actorToHandle(actor);
        actorHandles.value[actor] = handle;
      } catch {
        actorHandles.value[actor] = null;
      }
    }

    const actorDisplayNames = computed(() => {
      const map = new Map();
      for (const actor of allActors.value) {
        const profile = profileObjects.value
          .filter((p) => p.actor === actor)
          .toSorted((a, b) => b.value.published - a.value.published)[0];
        const displayName = profile?.value.displayName || null;
        if (!displayName) resolveHandle(actor);
        map.set(
          actor,
          displayName || actorHandles.value[actor] || actor.split(".")[0],
        );
      }
      return map;
    });

    function getActorInitial(actor) {
      const name = actorDisplayNames.value.get(actor) || actor;
      return (name || "?").substring(0, 1).toUpperCase();
    }

    // Compute latest message per page
    const pageLatestMessages = computed(() => {
      const map = new Map();
      for (const page of chatPages.value) {
        const msgs = pageMessageObjects.value
          .filter((m) => m.channels.includes(page.value.channel))
          .toSorted((a, b) => b.value.published - a.value.published);
        if (msgs.length > 0) {
          const latest = msgs[0];
          map.set(page.value.channel, {
            message: latest,
            senderName: actorDisplayNames.value.get(latest.actor) || "Unknown",
          });
        }
      }
      return map;
    });

    function getLatestMessageInfo(page) {
      return pageLatestMessages.value.get(page.value.channel);
    }

    // Members for each page with display info
    function getPageMembers(page) {
      return (page.value.members || []).map((actor) => ({
        actor,
        displayName: actorDisplayNames.value.get(actor) || null,
        initial: getActorInitial(actor),
      }));
    }

    // Parent chat members for the create form
    const parentChatMembers = computed(() =>
      memberActors.value.map((actor) => ({
        actor,
        displayName: actorDisplayNames.value.get(actor) || null,
        initial: getActorInitial(actor),
      })),
    );

    // Search + sort
    const filteredPages = computed(() => {
      const q = searchQuery.value.trim().toLowerCase();
      const pages = q
        ? chatPages.value.filter((p) =>
            p.value.title.toLowerCase().includes(q),
          )
        : chatPages.value;
      return pages.toSorted((a, b) => {
        const aLatest = pageLatestMessages.value.get(a.value.channel);
        const bLatest = pageLatestMessages.value.get(b.value.channel);
        const aTime = aLatest?.message.value.published || a.value.published;
        const bTime = bLatest?.message.value.published || b.value.published;
        return bTime - aTime;
      });
    });

    function toggleMember(actor) {
      const next = new Set(selectedMembers.value);
      if (next.has(actor)) next.delete(actor);
      else next.add(actor);
      selectedMembers.value = next;
    }

    function openCreateForm() {
      showCreateForm.value = true;
      // Pre-select current user
      if (session.value?.actor) {
        selectedMembers.value = new Set([session.value.actor]);
      }
    }

    function cancelCreate() {
      showCreateForm.value = false;
      newPageTitle.value = "";
      selectedMembers.value = new Set();
    }

    async function createPage() {
      if (!newPageTitle.value.trim() || selectedMembers.value.size === 0)
        return;

      isCreatingPage.value = true;
      try {
        const pageChannel = crypto.randomUUID();
        const members = [...selectedMembers.value];
        // Ensure creator is included
        if (!members.includes(session.value.actor)) {
          members.push(session.value.actor);
        }

        const pageValue = {
          activity: "Create",
          type: "Page",
          title: newPageTitle.value,
          channel: pageChannel,
          parentChatId: chatIdRef.value,
          members,
          published: Date.now(),
        };

        // Post page to each selected member's page-inbox
        await Promise.all(
          members.map((actor) =>
            graffiti.post(
              {
                value: pageValue,
                channels: [`${actor}/page-inbox`],
              },
              session.value,
            ),
          ),
        );

        // Post member records to page's /members channel
        await Promise.all(
          members.map((actor) =>
            graffiti.post(
              {
                value: {
                  activity: "Add",
                  type: "Member",
                  member: actor,
                  published: Date.now(),
                },
                channels: [`${pageChannel}/members`],
              },
              session.value,
            ),
          ),
        );

        cancelCreate();
      } finally {
        isCreatingPage.value = false;
      }
    }

    function openPage(page) {
      router.push({
        name: "page",
        params: {
          chatId: chatIdRef.value,
          pageId: page.value.channel,
        },
        state: {
          page: {
            title: page.value.title,
            channel: page.value.channel,
            parentChatId: page.value.parentChatId,
            members: page.value.members,
            published: page.value.published,
          },
          parentChatTitle: props.chatTitle,
        },
      });
    }

    function formatTimeSince(timestamp) {
      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return `${days}d`;
      if (hours > 0) return `${hours}h`;
      if (minutes > 0) return `${minutes}m`;
      return "now";
    }

    return {
      searchQuery,
      showCreateForm,
      newPageTitle,
      selectedMembers,
      isCreatingPage,
      arePagesLoading,
      filteredPages,
      parentChatMembers,
      getPageMembers,
      getLatestMessageInfo,
      formatTimeSince,
      openCreateForm,
      cancelCreate,
      toggleMember,
      createPage,
      openPage,
      close: () => emit("close"),
    };
  },
};
