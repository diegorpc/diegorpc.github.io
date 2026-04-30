import { ref, computed } from "vue";
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

    // discover chat objects
    // TODO: replace with user's personal channels once member invitations are implemented
    const { objects: chatObjects, isFirstPoll: areChatsLoading } =
      useGraffitiDiscover(
        [TEMP_SHARED_CHANNEL],
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

    const sortedChats = computed(() =>
      chatObjects.value.toSorted(
        (a, b) => b.value.published - a.value.published,
      ),
    );

    // ACTION 1: Create Chat
    async function createChat() {
      if (!newChatTitle.value.trim()) return;

      isCreatingChat.value = true;
      try {
        const chatChannel = crypto.randomUUID();

        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Chat",
              title: newChatTitle.value,
              channel: chatChannel,
              published: Date.now(),
            },
            channels: [TEMP_SHARED_CHANNEL],
          },
          session.value,
        );
        newChatTitle.value = "";
        showNewChatForm.value = false;
      } finally {
        isCreatingChat.value = false;
      }
    }

    // ACTION 3: Join/Open Chat
    function openChat(chat) {
      router.push({
        name: "chat",
        params: { chatId: chat.value.channel },
      });
    }

    function formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    }

    function getInitials(title) {
      return (title || "?").substring(0, 2).toUpperCase();
    }

    return {
      newChatTitle,
      isCreatingChat,
      showNewChatForm,
      areChatsLoading,
      sortedChats,
      createChat,
      openChat,
      formatTime,
      getInitials,
    };
  },
};
