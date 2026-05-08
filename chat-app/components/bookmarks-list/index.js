import { ref } from "vue";

export default {
  props: {
    bookmarks: { type: Array, default: () => [] },
    title: { type: String, default: "" },
  },
  emits: ["close", "scroll-to"],
  setup(props, { emit }) {
    const closing = ref(false);

    function handleClose() {
      if (closing.value) return;
      closing.value = true;
      setTimeout(() => emit("close"), 180);
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
      closing,
      close: handleClose,
      formatTimeSince,
    };
  },
};
