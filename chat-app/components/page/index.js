import { ref, computed, toRef, watchEffect } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { componentFromFolder } from "../component-loader.js";

const ChatMessage = componentFromFolder("../chat-message", import.meta.url);
const MembersList = componentFromFolder("../members-list", import.meta.url);

export default {
  components: { ChatMessage, MembersList },
  props: {
    chatId: { type: String, required: true },
    pageId: { type: String, required: true },
  },
  setup(props) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter();

    const myMessage = ref("");
    const isSendingMessage = ref(false);
    const showMembersList = ref(false);

    const chatIdRef = toRef(props, "chatId");
    const pageIdRef = toRef(props, "pageId");

    // Get page data from router state for immediate display
    const routeState = router.currentRoute.value.state || {};
    const initialPage = routeState.page || null;
    const initialParentTitle = routeState.parentChatTitle || "";

    const pageTitleRef = ref(initialPage?.title || "");
    const parentChatTitleRef = ref(initialParentTitle);
    const isPageLoaded = ref(!!initialPage);

    // Discover messages in the page's channel
    const { objects: messageObjects, isFirstPoll: areMessagesLoading } =
      useGraffitiDiscover(
        computed(() => [pageIdRef.value]),
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

    const sortedMessages = computed(() =>
      messageObjects.value.toSorted(
        (a, b) => a.value.published - b.value.published,
      ),
    );

    const uniqueActors = computed(() => [
      ...new Set(sortedMessages.value.map((m) => m.actor)),
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
              displayName: { type: "string" },
            },
          },
        },
      },
    );

    const actorDisplayNames = computed(() => {
      const map = new Map();
      for (const profile of profileObjects.value) {
        const latest = profileObjects.value
          .filter((p) => p.actor === profile.actor)
          .toSorted((a, b) => b.value.published - a.value.published)[0];
        if (latest && latest.value.displayName) {
          map.set(latest.actor, latest.value.displayName);
        }
      }
      return map;
    });

    const enrichedMessages = computed(() =>
      sortedMessages.value.map((msg, index) => {
        const prevMsg = index > 0 ? sortedMessages.value[index - 1] : null;
        const isBlockStart = !prevMsg || prevMsg.actor !== msg.actor;
        const displayName = actorDisplayNames.value.get(msg.actor) || null;
        return { message: msg, isBlockStart, displayName };
      }),
    );

    // Fallback discovery for page metadata (on direct navigation/refresh)
    const shouldDiscoverPage = computed(() => !initialPage);

    const { objects: pageMetaObjects } = useGraffitiDiscover(
      computed(() =>
        shouldDiscoverPage.value && session.value?.actor
          ? [`${session.value.actor}/page-inbox`]
          : [],
      ),
      {
        properties: {
          value: {
            required: ["activity", "type", "title", "channel", "parentChatId"],
            properties: {
              activity: { const: "Create" },
              type: { const: "Page" },
              title: { type: "string" },
              channel: { type: "string" },
              parentChatId: { type: "string" },
            },
          },
        },
      },
    );

    watchEffect(() => {
      if (!shouldDiscoverPage.value) return;
      const match = pageMetaObjects.value.find(
        (p) => p.value.channel === pageIdRef.value,
      );
      if (match?.value.title) {
        pageTitleRef.value = match.value.title;
        isPageLoaded.value = true;
      }
    });

    // Fallback discovery for parent chat title
    const shouldDiscoverChat = computed(() => !parentChatTitleRef.value);

    const { objects: chatMetaObjects } = useGraffitiDiscover(
      computed(() =>
        shouldDiscoverChat.value && session.value?.actor
          ? [
              `${session.value.actor}/chats`,
              `${session.value.actor}/inbox`,
            ]
          : [],
      ),
      {
        properties: {
          value: {
            required: ["activity", "type", "title", "channel"],
            properties: {
              activity: { const: "Create" },
              type: { const: "Chat" },
              title: { type: "string" },
              channel: { type: "string" },
            },
          },
        },
      },
    );

    watchEffect(() => {
      if (!shouldDiscoverChat.value) return;
      const match = chatMetaObjects.value.find(
        (c) => c.value.channel === chatIdRef.value,
      );
      if (match?.value.title) {
        parentChatTitleRef.value = match.value.title;
      }
    });

    const pageTitle = computed(() => pageTitleRef.value);
    const parentChatTitle = computed(() => parentChatTitleRef.value);

    async function sendMessage() {
      if (!myMessage.value.trim() || !pageIdRef.value) return;

      isSendingMessage.value = true;
      try {
        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Message",
              content: myMessage.value,
              target: pageIdRef.value,
              published: Date.now(),
            },
            channels: [pageIdRef.value],
          },
          session.value,
        );
        myMessage.value = "";
      } finally {
        isSendingMessage.value = false;
      }
    }

    function back() {
      router.push({ name: "chat", params: { chatId: chatIdRef.value } });
    }

    function getInitials(title) {
      return (title || "?").substring(0, 2).toUpperCase();
    }

    return {
      myMessage,
      isSendingMessage,
      showMembersList,
      areMessagesLoading,
      enrichedMessages,
      pageTitle,
      parentChatTitle,
      isPageLoaded,
      chatId: chatIdRef,
      pageId: pageIdRef,
      sendMessage,
      back,
      getInitials,
    };
  },
};
