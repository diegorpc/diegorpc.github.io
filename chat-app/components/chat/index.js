import { ref, computed, toRef } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { componentFromFolder } from "../component-loader.js";

const TEMP_SHARED_CHANNEL = "designftw-26";

const ChatMessage = componentFromFolder("../chat-message", import.meta.url);

export default {
  components: { ChatMessage },
  props: {
    chatId: { type: String, required: true },
  },
  setup(props) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter();

    const myMessage = ref("");
    const isSendingMessage = ref(false);

    const chatIdRef = toRef(props, "chatId");

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

    // Discover chat metadata to show its title.
    const { objects: chatMetaObjects } = useGraffitiDiscover(
      [TEMP_SHARED_CHANNEL],
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

    const chatTitle = computed(() => {
      const match = chatMetaObjects.value.find(
        (c) => c.value.channel === chatIdRef.value,
      );
      return match?.value.title ?? "";
    });

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
      areMessagesLoading,
      sortedMessages,
      chatTitle,
      sendMessage,
      back,
      getInitials,
    };
  },
};
