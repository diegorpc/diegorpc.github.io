import { ref, computed } from "vue";
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
    pageId: { type: String, required: true },
    pageOwner: { type: String, default: null },
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

    // Check if current user is the page owner
    const isOwner = computed(() => 
      session.value?.actor === props.pageOwner
    );

    const deleteButtonText = computed(() => {
      if (isDeleting.value) return 'Deleting...';
      if (confirmingDelete.value) return 'Click again to confirm';
      return 'Delete Page';
    });

    // Fetch page objects to get the latest
    const { objects: pageObjects } = useGraffitiDiscover(
      computed(() => session.value?.actor ? [`${session.value.actor}/page-inbox`] : []),
      {
        properties: {
          value: {
            required: ["activity", "type", "channel"],
            properties: {
              activity: { const: "Create" },
              type: { const: "Page" },
              channel: { const: props.pageId },
            },
          },
        },
      },
    );

    const latestPage = computed(() => {
      return pageObjects.value.find((p) => p.value.channel === props.pageId) ?? null;
    });

    // Check if there are changes
    const hasChanges = computed(() => {
      if (selectedFile.value || shouldRemovePhoto.value) return true;
      
      if (!latestPage.value) return false;
      
      const saved = latestPage.value.value;
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
      if (!session.value?.actor || !isOwner.value || !latestPage.value) return;
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

        const pageValue = {
          activity: "Create",
          type: "Page",
          title: title.value,
          channel: props.pageId,
          parentChatId: latestPage.value.value.parentChatId,
          owner: props.pageOwner,
          members: latestPage.value.value.members || [],
          published: Date.now(),
        };
        
        if (description.value.trim()) {
          pageValue.description = description.value;
        }
        
        if (newIconUrl) {
          pageValue.icon = newIconUrl;
        }

        // Delete previous page objects for all members
        const members = latestPage.value.value.members || [];
        await Promise.all(
          members.map(async (actor) => {
            const memberPages = pageObjects.value.filter(
              (p) => p.value.channel === props.pageId && p.channels.includes(`${actor}/page-inbox`)
            );
            return Promise.all(
              memberPages.map((p) => graffiti.delete(p, session.value).catch(() => {}))
            );
          })
        );

        // Post updated page to each member's page-inbox
        await Promise.all(
          members.map((actor) =>
            graffiti.post(
              {
                value: pageValue,
                channels: [`${actor}/page-inbox`],
              },
              session.value,
            ),
          ),
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
        deletePage();
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

    async function deletePage() {
      if (!latestPage.value || !session.value) return;
      
      isDeleting.value = true;
      try {
        // Delete page objects for all members
        const members = latestPage.value.value.members || [];
        await Promise.all(
          members.map(async (actor) => {
            const memberPages = pageObjects.value.filter(
              (p) => p.value.channel === props.pageId && p.channels.includes(`${actor}/page-inbox`)
            );
            return Promise.all(
              memberPages.map((p) => graffiti.delete(p, session.value).catch(() => {}))
            );
          })
        );
        
        handleClose();
        // Navigate back to parent chat after close animation
        setTimeout(() => window.history.back(), 180);
      } catch (error) {
        console.error("Failed to delete page:", error);
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
