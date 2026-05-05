import { ref, computed, watch } from "vue";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

export default {
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
              displayName: { type: "string" },
              bio: { type: "string" },
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

    function handleFileSelect(event) {
      const file = event.target.files[0];
      if (!file) return;
      if (localPreviewUrl.value) URL.revokeObjectURL(localPreviewUrl.value);
      selectedFile.value = file;
      localPreviewUrl.value = URL.createObjectURL(file);
    }

    async function saveProfile() {
      if (!session.value?.actor) return;
      isSavingProfile.value = true;
      try {
        let newIconUrl = iconUrl.value;
        if (selectedFile.value) {
          isUploadingPhoto.value = true;
          try {
            newIconUrl = await graffiti.postMedia({ data: selectedFile.value }, session.value);
            selectedFile.value = null;
            if (localPreviewUrl.value) URL.revokeObjectURL(localPreviewUrl.value);
            localPreviewUrl.value = null;
          } finally {
            isUploadingPhoto.value = false;
          }
        }

        const profileValue = {
          activity: "Update",
          type: "Profile",
          displayName: displayName.value,
          bio: bio.value,
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
      handleFileSelect,
      saveProfile,
      logout,
    };
  },
};
