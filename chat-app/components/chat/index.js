import { ref, computed, toRef, watchEffect, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { componentFromFolder } from "../component-loader.js";

const TEMP_SHARED_CHANNEL = "designftw-26";

const ChatMessage = componentFromFolder("../chat-message", import.meta.url);
const MembersList = componentFromFolder("../members-list", import.meta.url);
const PagesList = componentFromFolder("../pages-list", import.meta.url);

export default {
  components: { ChatMessage, MembersList, PagesList },
  props: {
    chatId: { type: String, required: true },
  },
  setup(props) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter();

    const myMessage = ref("");
    const isSendingMessage = ref(false);
    const showMembersList = ref(false);
    const showPagesList = ref(false);
    const replyingTo = ref(null);

    const chatIdRef = toRef(props, "chatId");

    // Get chat data from router state if available (for immediate display)
    const initialChatData = router.currentRoute.value.state?.chat || null;
    const chatTitleRef = ref(initialChatData?.title || "");
    const chatOwnerRef = ref(initialChatData?.owner || null);
    // Header is loaded immediately if we have initial data, otherwise wait for discovery
    const isChatLoaded = ref(!!initialChatData);

    // Get page notifications flag from query parameter
    const hasPageNotifications = ref(router.currentRoute.value.query.pageNotif === '1');
    
    // Clear the query parameter after reading it
    if (router.currentRoute.value.query.pageNotif) {
      router.replace({
        name: 'chat',
        params: { chatId: chatIdRef.value },
      });
    }

    // Discover messages in this chat's channel.
    const { objects: messageObjects, isFirstPoll } =
      useGraffitiDiscover(
        computed(() => [chatIdRef.value]),
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

    const areMessagesLoading = computed(
      () => (isFirstPoll.value && messageObjects.value.length === 0) || pendingHandles.value.size > 0,
    );

    const sortedMessages = computed(() =>
      messageObjects.value.toSorted(
        (a, b) => a.value.published - b.value.published,
      ),
    );

    // Discover read states for all messages in this chat
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


    // Get unique actors from messages to fetch their profiles
    const uniqueActors = computed(() => [
      ...new Set(sortedMessages.value.map((m) => m.actor)),
    ]);

    // Discover profiles for all actors in this chat
    const { objects: profileObjects } = useGraffitiDiscover(
      computed(() =>
        uniqueActors.value.map((actor) => `${actor}/profile`),
      ),
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
    
    // Map actor to display name
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

    // Enrich messages with block start indicator
    const enrichedMessages = computed(() =>
      sortedMessages.value.map((msg, index) => {
        const prevMsg = index > 0 ? sortedMessages.value[index - 1] : null;
        const isBlockStart = !prevMsg || prevMsg.actor !== msg.actor;
        const displayName = actorDisplayNames.value.get(msg.actor) || null;
        return { message: msg, isBlockStart, displayName };
      }),
    );

    // Discover chat metadata only if we don't have initial data (for direct navigation/refresh)
    const shouldDiscoverChat = computed(() => !initialChatData);
    
    const { objects: chatMetaObjects } = useGraffitiDiscover(
      computed(() => 
        shouldDiscoverChat.value && session.value?.actor
          ? [`${session.value.actor}/chats`, `${session.value.actor}/inbox`]
          : []
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

    // Update chat title from discovery only if needed (direct navigation without router state)
    watchEffect(() => {
      if (!shouldDiscoverChat.value) return;
      
      const match = chatMetaObjects.value.find(
        (c) => c.value.channel === chatIdRef.value,
      );
      if (match?.value.title) {
        chatTitleRef.value = match.value.title;
        chatOwnerRef.value = match.value.owner || null;
        isChatLoaded.value = true;
      }
    });

    const chatTitle = computed(() => chatTitleRef.value);
    const chatOwner = computed(() => chatOwnerRef.value);

    // Open pages list if query parameter is set
    watch(
      () => router.currentRoute.value.query.openPagesList,
      (shouldOpen) => {
        if (shouldOpen === 'true') {
          showPagesList.value = true;
          // Clear the query parameter
          router.replace({ 
            name: "chat", 
            params: { chatId: chatIdRef.value } 
          });
        }
      },
      { immediate: true }
    );

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
      if (!myMessage.value.trim() || !chatIdRef.value) return;

      isSendingMessage.value = true;
      try {
        const msgValue = {
          activity: "Create",
          type: "Message",
          content: myMessage.value,
          target: chatIdRef.value,
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
          { value: msgValue, channels: [chatIdRef.value] },
          session.value,
        );
        myMessage.value = "";
        replyingTo.value = null;
      } finally {
        isSendingMessage.value = false;
      }
    }

    function back() {
      router.push({ name: "home" });
    }

    function getInitials(title) {
      return (title || "?").substring(0, 2).toUpperCase();
    }

    return {
      myMessage,
      isSendingMessage,
      showMembersList,
      showPagesList,
      replyingTo,
      areMessagesLoading,
      enrichedMessages,
      readStateObjects,
      actorDisplayNames,
      uniqueActors,
      chatTitle,
      chatOwner,
      isChatLoaded,
      chatId: chatIdRef,
      sendMessage,
      handleReply,
      back,
      getInitials,
      hasPageNotifications,
    };
  },
};
