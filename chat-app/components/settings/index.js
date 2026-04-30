import { ref, watch } from "vue";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

export default {
  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();

    const showMessagePreview = ref(true);
    const hasHydrated = ref(false);

    // Discover user settings from their profile channel
    const { objects: settingsObjects } = useGraffitiDiscover(
      () => (session.value?.actor ? [`${session.value.actor}/settings`] : []),
      {
        properties: {
          value: {
            required: ["activity", "type"],
            properties: {
              activity: { const: "Update" },
              type: { const: "Settings" },
            },
          },
        },
      },
    );

    // Hydrate settings from latest object
    watch(
      settingsObjects,
      (objects) => {
        if (hasHydrated.value || !objects.length) return;
        const latest = objects
          .filter((o) => o.actor === session.value?.actor)
          .toSorted((a, b) => b.value.published - a.value.published)[0];
        if (latest) {
          showMessagePreview.value = latest.value.showMessagePreview ?? true;
          hasHydrated.value = true;
        }
      },
      { immediate: true },
    );

    async function saveSetting(key, value) {
      if (!session.value?.actor) return;

      // Delete previous settings
      const previous = settingsObjects.value.filter(
        (o) => o.actor === session.value.actor,
      );
      await Promise.all(
        previous.map((p) => graffiti.delete(p, session.value).catch(() => {})),
      );

      // Post new settings
      await graffiti.post(
        {
          value: {
            activity: "Update",
            type: "Settings",
            showMessagePreview: showMessagePreview.value,
            published: Date.now(),
          },
          channels: [`${session.value.actor}/settings`],
        },
        session.value,
      );
    }

    return {
      showMessagePreview,
      saveSetting,
    };
  },
};
