import { ref, computed, watch } from "vue";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { componentFromFolder } from "../component-loader.js";

const Avatar = componentFromFolder("../avatar", import.meta.url);

export default {
  components: { Avatar },
  props: {
    chatId: { type: String, required: true },
    chatOwner: { type: String, default: null },
    initialTitle: { type: String, default: "" },
    initialIcon: { type: String, default: "" },
    initialDescription: { type: String, default: "" },
  },
  emits: ["close", "updated"],
  setup(props, { emit }) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();

    const title = ref(props.initialTitle);
    const description = ref(props.initialDescription);
    const iconUrl = ref(props.initialIcon);
    const selectedFile = ref(null);
    const localPreviewUrl = ref(null);
    const isSaving = ref(false);
    const isUploadingPhoto = ref(false);
    const shouldRemovePhoto = ref(false);
    const confirmingDelete = ref(false);
    const isDeleting = ref(false);
    let deleteConfirmTimeout = null;

    // Check if current user is the chat owner
    const isOwner = computed(() => 
      session.value?.actor === props.chatOwner
    );

    const deleteButtonText = computed(() => {
      if (isDeleting.value) return 'Deleting...';
      if (confirmingDelete.value) return 'Click again to confirm';
      return 'Delete Chat';
    });

    // Fetch the latest chat object
    const { objects: chatObjects } = useGraffitiDiscover(
      computed(() => session.value?.actor ? [`${session.value.actor}/chats`] : []),
      {
        properties: {
          value: {
            required: ["activity", "type", "channel"],
            properties: {
              activity: { const: "Create" },
              type: { const: "Chat" },
              channel: { const: props.chatId },
            },
          },
        },
      },
    );

    const latestChat = computed(() => {
      return chatObjects.value.find((c) => c.value.channel === props.chatId) ?? null;
    });

    // Check if there are changes
    const hasChanges = computed(() => {
      if (selectedFile.value || shouldRemovePhoto.value) return true;
      
      if (!latestChat.value) return false;
      
      const saved = latestChat.value.value;
      return (
        title.value !== (saved.title ?? "") ||
        description.value !== (saved.description ?? "")
      );
    });

    function handleFileSelect(event) {
      const file = event.target.files[0];
      if (!file) return;
      if (localPreviewUrl.value) URL.revokeObjectURL(localPreviewUrl.value);
      selectedFile.value = file;
      localPreviewUrl.value = URL.createObjectURL(file);
      shouldRemovePhoto.value = false;
    }

    function removePhoto() {
      if (localPreviewUrl.value) {
        URL.revokeObjectURL(localPreviewUrl.value);
      }
      selectedFile.value = null;
      localPreviewUrl.value = null;
      shouldRemovePhoto.value = true;
    }

    async function save() {
      if (!session.value?.actor || !isOwner.value) return;
      isSaving.value = true;
      try {
        let newIconUrl = iconUrl.value;
        
        // Handle photo removal
        if (shouldRemovePhoto.value) {
          newIconUrl = "";
          shouldRemovePhoto.value = false;
        } else if (selectedFile.value) {
          // Upload new photo
          isUploadingPhoto.value = true;
          try {
            newIconUrl = await graffiti.postMedia({ data: selectedFile.value }, session.value);
            selectedFile.value = null;
            // Keep preview URL until after we update iconUrl to prevent flashing
          } finally {
            isUploadingPhoto.value = false;
          }
        }

        const chatValue = {
          activity: "Create",
          type: "Chat",
          title: title.value,
          channel: props.chatId,
          owner: props.chatOwner,
          published: Date.now(),
        };
        
        if (description.value.trim()) {
          chatValue.description = description.value;
        }
        
        if (newIconUrl) {
          chatValue.icon = newIconUrl;
        }

        // Delete previous chat object
        if (latestChat.value) {
          await graffiti.delete(latestChat.value, session.value).catch(() => {});
        }

        // Post updated chat
        await graffiti.post(
          {
            value: chatValue,
            channels: [`${session.value.actor}/chats`],
          },
          session.value,
        );

        iconUrl.value = newIconUrl;
        
        // Clear preview URL after iconUrl is updated (prevents flash)
        if (localPreviewUrl.value) {
          URL.revokeObjectURL(localPreviewUrl.value);
          localPreviewUrl.value = null;
        }
        
        emit("updated", { title: title.value, icon: newIconUrl, description: description.value });
        handleClose();
      } finally {
        isSaving.value = false;
      }
    }

    function handleDeleteClick() {
      if (confirmingDelete.value) {
        // Second click - actually delete
        if (deleteConfirmTimeout) {
          clearTimeout(deleteConfirmTimeout);
          deleteConfirmTimeout = null;
        }
        deleteChat();
      } else {
        // First click - show confirmation text
        confirmingDelete.value = true;
        // Reset after 3 seconds if they don't click again
        deleteConfirmTimeout = setTimeout(() => {
          confirmingDelete.value = false;
          deleteConfirmTimeout = null;
        }, 3000);
      }
    }

    async function deleteChat() {
      if (!latestChat.value || !session.value) return;
      
      isDeleting.value = true;
      try {
        // Delete the chat object
        await graffiti.delete(latestChat.value, session.value);
        handleClose();
        // Navigate back to chat list after close animation
        setTimeout(() => window.history.back(), 180);
      } catch (error) {
        console.error("Failed to delete chat:", error);
      } finally {
        isDeleting.value = false;
      }
    }

    const closing = ref(false);
    function handleClose() {
      if (closing.value) return;
      closing.value = true;
      setTimeout(() => emit("close"), 180);
    }

    function close() {
      handleClose();
    }

    return {
      title,
      description,
      iconUrl,
      localPreviewUrl,
      isSaving,
      isUploadingPhoto,
      hasChanges,
      shouldRemovePhoto,
      isOwner,
      confirmingDelete,
      isDeleting,
      deleteButtonText,
      handleFileSelect,
      removePhoto,
      save,
      closing,
      handleDeleteClick,
      close,
    };
  },
};
