import { ref, computed } from "vue";
import {
  useGraffiti,
  useGraffitiSession,
} from "@graffiti-garden/wrapper-vue";

const MENU_WIDTH = 240;
const MENU_MARGIN = 8;
const MIN_SPACE_BELOW = 200;

export default {
  props: {
    message: { type: Object, required: true },
    isBlockStart: { type: Boolean, default: false },
    displayName: { type: String, default: null },
    readStateObjects: { type: Array, default: () => [] },
    actorDisplayNames: { type: Object, default: () => new Map() },
    messageActors: { type: Array, default: () => [] },
  },
  emits: ["reply"],
  setup(props, { emit }) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();

    const isDeleting = ref(false);
    const confirmingDelete = ref(false);
    const showMenu = ref(false);
    const showReadStatus = ref(false);
    const menuAnchor = ref(null);
    let longPressTimer = null;

    const isOwnMessage = computed(
      () => props.message.actor === session.value?.actor,
    );

    // Deduplicated read states for this message — keep oldest per reader (= first read time)
    const messageReadStates = computed(() => {
      const forMsg = props.readStateObjects.filter(
        (rs) => rs.value.messageUrl === props.message.url,
      );
      const byReader = new Map();
      for (const rs of forMsg) {
        const prev = byReader.get(rs.value.reader);
        if (!prev || rs.value.published < prev.value.published) {
          byReader.set(rs.value.reader, rs);
        }
      }
      return [...byReader.values()];
    });

    // Per-actor read status including the timestamp of first read
    const readStatusPerActor = computed(() => {
      const readStatesMap = new Map(
        messageReadStates.value.map((rs) => [rs.value.reader, rs]),
      );
      return props.messageActors
        .filter((actor) => actor !== props.message.actor)
        .map((actor) => {
          const rs = readStatesMap.get(actor);
          return {
            actor,
            hasRead: !!rs,
            displayName: getReaderDisplayName(actor),
            readAt: rs?.value.published ?? null,
          };
        });
    });

    const replyQuote = computed(() => {
      const rt = props.message.value.replyTo;
      if (!rt) return null;
      const names = props.actorDisplayNames;
      return {
        content: rt.content,
        actor: rt.actor,
        displayName: names instanceof Map ? names.get(rt.actor) ?? null : null,
      };
    });

    // True when there is enough viewport space below the message for a floating card
    const menuFloating = computed(() => {
      if (!menuAnchor.value) return false;
      return window.innerHeight - menuAnchor.value.outerBottom - MENU_MARGIN >= MIN_SPACE_BELOW;
    });

    // Style for the floating menu card or the bottom sheet
    const menuStyle = computed(() => {
      if (!menuAnchor.value || !menuFloating.value) {
        return {
          position: "fixed",
          bottom: "0",
          left: "0",
          right: "0",
          borderRadius: "20px 20px 0 0",
        };
      }
      const { outerBottom, outerLeft, outerRight } = menuAnchor.value;
      const vw = window.innerWidth;
      const base = {
        position: "fixed",
        top: `${outerBottom + MENU_MARGIN}px`,
        width: `${MENU_WIDTH}px`,
        borderRadius: "14px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.22)",
        bottom: "auto",
      };
      if (isOwnMessage.value) {
        base.right = `${Math.max(MENU_MARGIN, Math.min(vw - outerRight, vw - MENU_WIDTH - MENU_MARGIN))}px`;
        base.left = "auto";
      } else {
        base.left = `${Math.max(MENU_MARGIN, Math.min(outerLeft, vw - MENU_WIDTH - MENU_MARGIN))}px`;
        base.right = "auto";
      }
      return base;
    });

    // Style to position the lifted bubble exactly over the actual bubble in the overlay
    const liftedBubbleStyle = computed(() => {
      if (!menuAnchor.value || !menuFloating.value) return {};
      const { bubbleTop, bubbleLeft, bubbleRight, bubbleWidth } = menuAnchor.value;
      const style = {
        position: "fixed",
        top: `${bubbleTop}px`,
        width: `${bubbleWidth}px`,
      };
      if (isOwnMessage.value) {
        style.right = `${window.innerWidth - bubbleRight}px`;
        style.left = "auto";
      } else {
        style.left = `${bubbleLeft}px`;
        style.right = "auto";
      }
      return style;
    });

    async function deleteMessage() {
      confirmingDelete.value = false;
      isDeleting.value = true;
      try {
        await graffiti.delete(props.message, session.value);
        showMenu.value = false;
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

    function captureAnchor(el) {
      const bubbleEl = el.querySelector(".message-bubble") || el;
      const bubbleRect = bubbleEl.getBoundingClientRect();
      const outerRect = el.getBoundingClientRect();
      menuAnchor.value = {
        bubbleTop: bubbleRect.top,
        bubbleLeft: bubbleRect.left,
        bubbleRight: bubbleRect.right,
        bubbleWidth: bubbleRect.width,
        outerBottom: outerRect.bottom,
        outerLeft: outerRect.left,
        outerRight: outerRect.right,
      };
    }

    function openMenu(event) {
      event.preventDefault();
      captureAnchor(event.currentTarget);
      showMenu.value = true;
      showReadStatus.value = false;
      confirmingDelete.value = false;
    }

    function closeMenu() {
      showMenu.value = false;
      showReadStatus.value = false;
      confirmingDelete.value = false;
    }

    function startLongPress(event) {
      const el = event.currentTarget;
      longPressTimer = setTimeout(() => {
        captureAnchor(el);
        showMenu.value = true;
        showReadStatus.value = false;
        confirmingDelete.value = false;
      }, 500);
    }

    function cancelLongPress() {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    function handleReply() {
      emit("reply", {
        url: props.message.url,
        content: props.message.value.content,
        actor: props.message.actor,
        displayName: props.displayName,
      });
      closeMenu();
    }

    function getReaderDisplayName(actor) {
      const names = props.actorDisplayNames;
      return (names instanceof Map ? names.get(actor) : null) || actor.split(".")[0];
    }

    return {
      isOwnMessage,
      isDeleting,
      confirmingDelete,
      showMenu,
      showReadStatus,
      menuStyle,
      menuFloating,
      liftedBubbleStyle,
      messageReadStates,
      readStatusPerActor,
      replyQuote,
      deleteMessage,
      formatTime,
      openMenu,
      closeMenu,
      startLongPress,
      cancelLongPress,
      handleReply,
      getReaderDisplayName,
    };
  },
};
