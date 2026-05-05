import { ref, computed, toRef, watchEffect, onMounted } from "vue";
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
    const replyingTo = ref(null);

    const chatIdRef = toRef(props, "chatId");
    const pageIdRef = toRef(props, "pageId");

    // Get page data from router state for immediate display
    const routeState = router.currentRoute.value.state || {};
    const initialPage = routeState.page || null;
    const initialParentTitle = routeState.parentChatTitle || "";

    const pageTitleRef = ref(initialPage?.title || "");
    const pageOwnerRef = ref(initialPage?.owner || null);
    const parentChatTitleRef = ref(initialParentTitle);
    const isPageLoaded = ref(!!initialPage);

    // Discover messages in the page's channel
    const { objects: messageObjects, isFirstPoll } =
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

    // Discover read states for all messages in this page
    const messageUrls = computed(() => messageObjects.value.map((m) => m.url));
    const readStateChannels = computed(() =>
      messageUrls.value.map((url) => `${url}/read-by`),
    );

    const { objects: readStateObjects } = useGraffitiDiscover(
      readStateChannels,
      {
        properties: {
          value: {
            required: ["activity", "type", "reader", "messageUrl", "published"],
            properties: {
              activity: { const: "Create" },
              type: { const: "ReadState" },
              reader: { type: "string" },
              messageUrl: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
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

    // Cache for resolved handles
    const handleCache = ref(new Map());
    const pendingHandles = ref(new Set());
    
    // Resolve handle for an actor (with caching)
    async function getActorHandle(actor) {
      if (handleCache.value.has(actor)) {
        return handleCache.value.get(actor);
      }
      if (pendingHandles.value.has(actor)) {
        return null; // Already resolving
      }
      
      pendingHandles.value.add(actor);
      try {
        const handle = await graffiti.actorToHandle(actor);
        handleCache.value.set(actor, handle);
        return handle;
      } catch {
        const fallback = actor.split(".")[0];
        handleCache.value.set(actor, fallback);
        return fallback;
      } finally {
        pendingHandles.value.delete(actor);
      }
    }
    
    const actorDisplayNames = computed(() => {
      const map = new Map();
      for (const actor of uniqueActors.value) {
        const profile = profileObjects.value
          .filter((p) => p.actor === actor)
          .toSorted((a, b) => b.value.published - a.value.published)[0];
        
        if (profile?.value.displayName) {
          map.set(actor, profile.value.displayName);
        } else {
          // Trigger handle resolution if not cached
          if (!handleCache.value.has(actor)) {
            getActorHandle(actor);
          }
          map.set(actor, handleCache.value.get(actor) || actor.split(".")[0]);
        }
      }
      return map;
    });
    
    const areMessagesLoading = computed(
      () => (isFirstPoll.value && messageObjects.value.length === 0) || pendingHandles.value.size > 0,
    );

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
        pageOwnerRef.value = match.value.owner || null;
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
    const pageOwner = computed(() => pageOwnerRef.value);
    const parentChatTitle = computed(() => parentChatTitleRef.value);

    // Track in-flight posts to avoid duplicate read states from concurrent watchEffect firings
    const pendingReadUrls = new Set();

    async function markMessagesAsRead() {
      if (!session.value?.actor || messageObjects.value.length === 0) return;

      const messagesToMarkRead = messageObjects.value.filter((msg) => {
        if (pendingReadUrls.has(msg.url)) return false;
        const hasReadState = readStateObjects.value.some(
          (rs) =>
            rs.value.messageUrl === msg.url &&
            rs.value.reader === session.value.actor,
        );
        return !hasReadState && msg.actor !== session.value.actor;
      });

      if (messagesToMarkRead.length === 0) return;
      messagesToMarkRead.forEach((msg) => pendingReadUrls.add(msg.url));

      try {
        await Promise.all(
          messagesToMarkRead.map((msg) =>
            graffiti.post(
              {
                value: {
                  activity: "Create",
                  type: "ReadState",
                  reader: session.value.actor,
                  messageUrl: msg.url,
                  published: Date.now(),
                },
                channels: [`${msg.url}/read-by`],
              },
              session.value,
            ),
          ),
        );
      } catch (err) {
        console.error("Error marking messages as read:", err);
        messagesToMarkRead.forEach((msg) => pendingReadUrls.delete(msg.url));
      }
    }

    // Mark messages as read when component mounts and when messages change
    onMounted(() => {
      markMessagesAsRead();
    });

    watchEffect(() => {
      // Re-run when messages or read states change
      if (messageObjects.value.length > 0 && readStateObjects.value) {
        markMessagesAsRead();
      }
    });

    function handleReply(replyInfo) {
      replyingTo.value = replyInfo;
    }

    async function sendMessage() {
      if (!myMessage.value.trim() || !pageIdRef.value) return;

      isSendingMessage.value = true;
      try {
        const msgValue = {
          activity: "Create",
          type: "Message",
          content: myMessage.value,
          target: pageIdRef.value,
          published: Date.now(),
        };
        if (replyingTo.value) {
          msgValue.replyTo = {
            url: replyingTo.value.url,
            content: replyingTo.value.content,
            actor: replyingTo.value.actor,
          };
        }
        await graffiti.post(
          { value: msgValue, channels: [pageIdRef.value] },
          session.value,
        );
        myMessage.value = "";
        replyingTo.value = null;
      } finally {
        isSendingMessage.value = false;
      }
    }

    function back() {
      router.push({ 
        name: "chat", 
        params: { chatId: chatIdRef.value },
        query: { openPagesList: 'true' }
      });
    }

    function getInitials(title) {
      return (title || "?").substring(0, 2).toUpperCase();
    }

    return {
      myMessage,
      isSendingMessage,
      showMembersList,
      replyingTo,
      areMessagesLoading,
      enrichedMessages,
      readStateObjects,
      actorDisplayNames,
      uniqueActors,
      pageTitle,
      pageOwner,
      parentChatTitle,
      isPageLoaded,
      chatId: chatIdRef,
      pageId: pageIdRef,
      sendMessage,
      handleReply,
      back,
      getInitials,
    };
  },
};
