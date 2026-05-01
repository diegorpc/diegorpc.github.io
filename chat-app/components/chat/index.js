import { ref, computed, toRef, watchEffect } from "vue";
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

export default {
  components: { ChatMessage, MembersList },
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

    const chatIdRef = toRef(props, "chatId");

    // Get chat data from router state if available (for immediate display)
    const initialChatData = router.currentRoute.value.state?.chat || null;
    const chatTitleRef = ref(initialChatData?.title || "");
    // Header is loaded immediately if we have initial data, otherwise wait for discovery
    const isChatLoaded = ref(!!initialChatData);

    // Discover messages in this chat's channel.
    const { objects: messageObjects, isFirstPoll: areMessagesLoading } =
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

    const sortedMessages = computed(() =>
      messageObjects.value.toSorted(
        (a, b) => a.value.published - b.value.published,
      ),
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

    // Map actor to display name
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
        isChatLoaded.value = true;
      }
    });

    const chatTitle = computed(() => chatTitleRef.value);

    async function sendMessage() {
      if (!myMessage.value.trim() || !chatIdRef.value) return;

      isSendingMessage.value = true;
      try {
        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Message",
              content: myMessage.value,
              target: chatIdRef.value,
              published: Date.now(),
            },
            channels: [chatIdRef.value],
          },
          session.value,
        );
        myMessage.value = "";
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
      areMessagesLoading,
      enrichedMessages,
      chatTitle,
      isChatLoaded,
      chatId: chatIdRef,
      sendMessage,
      back,
      getInitials,
    };
  },
};
