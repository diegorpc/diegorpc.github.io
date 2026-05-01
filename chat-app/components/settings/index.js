import { ref, watchEffect, nextTick } from "vue";
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
    const isHydrated = ref(false);

    // Discover user settings from their profile channel
    const { objects: settingsObjects, isFirstPoll } = useGraffitiDiscover(
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

    // Sync settings from Graffiti
    watchEffect(() => {
      if (!session.value?.actor) return;
      const latest = settingsObjects.value
        .filter((o) => o.actor === session.value.actor)
        .toSorted((a, b) => b.value.published - a.value.published)[0];
      if (latest) {
        showMessagePreview.value = latest.value.showMessagePreview ?? true;
      }
      if (!isFirstPoll.value && !isHydrated.value) {
        nextTick(() => {
          requestAnimationFrame(() => {
            isHydrated.value = true;
          });
        });
      }
    });

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
      isHydrated,
      saveSetting,
    };
  },
};
