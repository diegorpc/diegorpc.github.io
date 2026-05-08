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
  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();

    const displayName = ref("");
    const bio = ref("");
    const iconUrl = ref("");
    const selectedFile = ref(null);
    const localPreviewUrl = ref(null);
    const isSavingProfile = ref(false);
    const isUploadingPhoto = ref(false);
    const hasHydrated = ref(false);
    const shouldRemovePhoto = ref(false);

    // Each user stores their profile in their own `${actor}/profile` channel.
    const profileChannels = computed(() =>
      session.value?.actor ? [`${session.value.actor}/profile`] : [],
    );

    const { objects: profileObjects, isFirstPoll: isLoadingProfile } =
      useGraffitiDiscover(profileChannels, {
        properties: {
          value: {
            required: ["activity", "type", "published"],
            properties: {
              activity: { const: "Update" },
              type: { const: "Profile" },
              displayName: { type: "string", maxLength: 20 },
              bio: { type: "string", maxLength: 100 },
              published: { type: "number" },
            },
          },
        },
      });

    // Latest profile object authored by the current user.
    const latestProfile = computed(() => {
      const actor = session.value?.actor;
      if (!actor) return null;
      const owned = profileObjects.value.filter((o) => o.actor === actor);
      return (
        owned.toSorted((a, b) => b.value.published - a.value.published)[0] ??
        null
      );
    });

    // Hydrate the form once we receive the latest profile from graffiti.
    watch(
      latestProfile,
      (profile) => {
        if (hasHydrated.value || !profile) return;
        displayName.value = profile.value.displayName ?? "";
        bio.value = profile.value.bio ?? "";
        iconUrl.value = profile.value.icon ?? "";
        hasHydrated.value = true;
      },
      { immediate: true },
    );

    // Check if profile has changed from saved version
    const hasChanges = computed(() => {
      // If there's a new file selected or photo marked for removal, there are changes
      if (selectedFile.value || shouldRemovePhoto.value) return true;
      
      // If no profile exists yet, any non-empty field is a change
      if (!latestProfile.value) {
        return displayName.value.trim() !== "" || bio.value.trim() !== "";
      }
      
      // Compare current values with saved profile
      const saved = latestProfile.value.value;
      return (
        displayName.value !== (saved.displayName ?? "") ||
        bio.value !== (saved.bio ?? "")
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

    async function saveProfile() {
      if (!session.value?.actor) return;
      isSavingProfile.value = true;
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

        // Enforce character limits on backend
        const truncatedDisplayName = displayName.value.slice(0, 20);
        const truncatedBio = bio.value.slice(0, 100);

        const profileValue = {
          activity: "Update",
          type: "Profile",
          displayName: truncatedDisplayName,
          bio: truncatedBio,
          published: Date.now(),
        };
        if (newIconUrl) profileValue.icon = newIconUrl;

        const previous = profileObjects.value.filter(
          (o) => o.actor === session.value.actor,
        );

        await graffiti.post(
          {
            value: profileValue,
            channels: [`${session.value.actor}/profile`],
          },
          session.value,
        );

        await Promise.all(
          previous.map((p) => graffiti.delete(p, session.value).catch(() => {})),
        );

        iconUrl.value = newIconUrl;
        
        // Clear preview URL after iconUrl is updated (prevents flash)
        if (localPreviewUrl.value) {
          URL.revokeObjectURL(localPreviewUrl.value);
          localPreviewUrl.value = null;
        }
        
        hasHydrated.value = true;
      } finally {
        isSavingProfile.value = false;
      }
    }

    function logout() {
      if (session.value) {
        graffiti.logout(session.value);
      }
    }

    return {
      displayName,
      bio,
      iconUrl,
      localPreviewUrl,
      isSavingProfile,
      isUploadingPhoto,
      isLoadingProfile,
      hasChanges,
      shouldRemovePhoto,
      handleFileSelect,
      removePhoto,
      saveProfile,
      logout,
    };
  },
};
