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
    const isSavingProfile = ref(false);
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
        hasHydrated.value = true;
      },
      { immediate: true },
    );

    async function saveProfile() {
      if (!session.value?.actor) return;
      isSavingProfile.value = true;
      try {
        // Delete any previous profile objects so the latest one is unambiguous.
        const previous = profileObjects.value.filter(
          (o) => o.actor === session.value.actor,
        );
        await Promise.all(
          previous.map((p) => graffiti.delete(p, session.value).catch(() => {})),
        );

        await graffiti.post(
          {
            value: {
              activity: "Update",
              type: "Profile",
              displayName: displayName.value,
              bio: bio.value,
              published: Date.now(),
            },
            channels: [`${session.value.actor}/profile`],
          },
          session.value,
        );
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
      isSavingProfile,
      isLoadingProfile,
      saveProfile,
      logout,
    };
  },
};
