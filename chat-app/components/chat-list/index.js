import { ref, computed, watchEffect } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

// for now just using the shared channel to discover chats from studio
// later, chats would be discovered from:
// user's personal "/chats" channel (chats user created)
// user's "/inbox" channel (chats user was invited to)
const TEMP_SHARED_CHANNEL = "designftw-26";

export default {
  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter();

    const newChatTitle = ref("");
    const isCreatingChat = ref(false);
    const showNewChatForm = ref(false);
    const searchQuery = ref("");

    // Fetch user settings to control message preview display
    const showMessagePreview = ref(true);
    const { objects: settingsObjects } = useGraffitiDiscover(
      () => (session.value?.actor ? [`${session.value.actor}/settings`] : []),
      {
        properties: {
          value: {
            required: ["activity", "type"],
            properties: {
              activity: { const: "Update" },
              type: { const: "Settings" },
            },
          },
        },
      },
    );

    // Sync settings from Graffiti
    watchEffect(() => {
      if (!session.value?.actor) return;
      const latest = settingsObjects.value
        .filter((o) => o.actor === session.value?.actor)
        .toSorted((a, b) => b.value.published - a.value.published)[0];
      if (latest) {
        showMessagePreview.value = latest.value.showMessagePreview ?? true;
      }
    });

    // Discover chats from user's personal channels
    const { objects: chatObjects, isFirstPoll: areChatsLoading } =
      useGraffitiDiscover(
        computed(() => 
          session.value?.actor 
            ? [`${session.value.actor}/chats`, `${session.value.actor}/inbox`]
            : []
        ),
        {
          properties: {
            value: {
              required: ["activity", "type", "title", "channel", "published"],
              properties: {
                activity: { const: "Create" },
                type: { const: "Chat" },
                title: { type: "string" },
                channel: { type: "string" },
                published: { type: "number" },
              },
            },
          },
        },
        undefined,
        true,
      );

    // Discover messages for all chats
    const chatChannels = computed(() =>
      chatObjects.value.map((c) => c.value.channel),
    );

    const { objects: allMessageObjects, isFirstPoll: areMessagesLoading } = useGraffitiDiscover(
      chatChannels,
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
      undefined,
      true,
    );

    // Combined loading state - wait for both chats and messages
    const isLoading = computed(() => areChatsLoading.value || areMessagesLoading.value);

    // Get unique actors from all messages to fetch their profiles
    const uniqueActors = computed(() => [
      ...new Set(allMessageObjects.value.map((m) => m.actor)),
    ]);

    const { objects: profileObjects } = useGraffitiDiscover(
      computed(() => uniqueActors.value.map((a) => `${a}/profile`)),
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

    // Resolve handles for actors
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

    // Map actor to display name
    const actorDisplayNames = computed(() => {
      const map = new Map();
      for (const actor of uniqueActors.value) {
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

    // Compute latest message per chat
    const chatLatestMessages = computed(() => {
      const map = new Map();
      for (const chat of chatObjects.value) {
        const chatMessages = allMessageObjects.value
          .filter((m) => m.channels.includes(chat.value.channel))
          .toSorted((a, b) => b.value.published - a.value.published);
        if (chatMessages.length > 0) {
          const latest = chatMessages[0];
          map.set(chat.value.channel, {
            message: latest,
            senderName: actorDisplayNames.value.get(latest.actor) || "Unknown",
          });
        }
      }
      return map;
    });

    const sortedChats = computed(() => {
      const q = searchQuery.value.trim().toLowerCase();
      const chats = q
        ? chatObjects.value.filter((chat) =>
            chat.value.title.toLowerCase().includes(q),
          )
        : chatObjects.value;
      return chats.toSorted((a, b) => {
        const aLatest = chatLatestMessages.value.get(a.value.channel);
        const bLatest = chatLatestMessages.value.get(b.value.channel);
        const aTime = aLatest?.message.value.published || a.value.published;
        const bTime = bLatest?.message.value.published || b.value.published;
        return bTime - aTime;
      });
    });

    async function createChat() {
      if (!newChatTitle.value.trim()) return;

      isCreatingChat.value = true;
      try {
        const chatChannel = crypto.randomUUID();

        // Post chat to creator's /chats channel
        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Chat",
              title: newChatTitle.value,
              channel: chatChannel,
              published: Date.now(),
            },
            channels: [`${session.value.actor}/chats`],
          },
          session.value,
        );

        // Auto-add creator as first member
        await graffiti.post(
          {
            value: {
              activity: "Add",
              type: "Member",
              member: session.value.actor,
              published: Date.now(),
            },
            channels: [`${chatChannel}/members`],
          },
          session.value,
        );

        newChatTitle.value = "";
        showNewChatForm.value = false;
      } finally {
        isCreatingChat.value = false;
      }
    }

    function openChat(chat) {
      router.push({
        name: "chat",
        params: { chatId: chat.value.channel },
        state: { chat: chat.value },
      });
    }

    function formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
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

    function getLatestMessageInfo(chat) {
      return chatLatestMessages.value.get(chat.value.channel);
    }

    function getInitials(title) {
      return (title || "?").substring(0, 2).toUpperCase();
    }

    return {
      newChatTitle,
      isCreatingChat,
      showNewChatForm,
      searchQuery,
      isLoading,
      sortedChats,
      showMessagePreview,
      createChat,
      openChat,
      formatTime,
      formatTimeSince,
      getInitials,
      getLatestMessageInfo,
    };
  },
};
