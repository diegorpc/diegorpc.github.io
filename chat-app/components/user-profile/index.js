import { ref, computed, onMounted } from "vue";
import {
  useGraffiti,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { componentFromFolder } from "../component-loader.js";

const Avatar = componentFromFolder("../avatar", import.meta.url);

export default {
  components: { Avatar },
  props: {
    actor: { type: String, required: true },
  },
  emits: ["close"],
  setup(props, { emit }) {
    const graffiti = useGraffiti();

    const handle = ref(null);
    const isResolvingHandle = ref(true);

    const { objects: profileObjects, isFirstPoll: isLoadingProfile } =
      useGraffitiDiscover(
        computed(() => [`${props.actor}/profile`]),
        {
          properties: {
            value: {
              required: ["activity", "type"],
              properties: {
                activity: { const: "Update" },
                type: { const: "Profile" },
              },
            },
          },
        },
      );

    const latestProfile = computed(() =>
      profileObjects.value
        .filter((o) => o.actor === props.actor)
        .toSorted((a, b) => b.value.published - a.value.published)[0] ?? null,
    );

    const displayName = computed(() => latestProfile.value?.value.displayName || null);
    const bio = computed(() => latestProfile.value?.value.bio || null);
    const photoUrl = computed(() => latestProfile.value?.value.icon || null);
    const initial = computed(() => {
      const name = displayName.value || handle.value || props.actor;
      return (name || "?").substring(0, 1).toUpperCase();
    });

    const isLoading = computed(() => isLoadingProfile.value || isResolvingHandle.value);

    onMounted(async () => {
      try {
        handle.value = await graffiti.actorToHandle(props.actor);
      } catch {
        handle.value = props.actor.split(".")[0];
      } finally {
        isResolvingHandle.value = false;
      }
    });

    const closing = ref(false);

    function handleClose() {
      if (closing.value) return;
      closing.value = true;
      setTimeout(() => emit("close"), 180);
    }

    return { handle, displayName, bio, photoUrl, initial, isLoading, closing, handleClose };
  },
};
