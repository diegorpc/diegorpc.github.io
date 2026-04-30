import { ref, computed } from "vue";
import {
  useGraffiti,
  useGraffitiSession,
} from "@graffiti-garden/wrapper-vue";

export default {
  props: {
    message: { type: Object, required: true },
  },
  setup(props) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();

    const isDeleting = ref(false);

    const isOwnMessage = computed(
      () => props.message.actor === session.value?.actor,
    );

    async function deleteMessage() {
      isDeleting.value = true;
      try {
        await graffiti.delete(props.message, session.value);
      } finally {
        isDeleting.value = false;
      }
    }

    function formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    }

    return {
      isOwnMessage,
      isDeleting,
      deleteMessage,
      formatTime,
    };
  },
};
