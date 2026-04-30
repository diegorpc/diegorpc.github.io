import { ref, computed, toRef } from "vue";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

export default {
  props: {
    chatId: { type: String, required: true },
  },
  emits: ["close"],
  setup(props) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const chatIdRef = toRef(props, "chatId");

    const showInviteForm = ref(false);
    const inviteHandle = ref("");
    const isInviting = ref(false);
    const inviteError = ref("");

    // Discover membership records
    const { objects: memberObjects } = useGraffitiDiscover(
      computed(() => [`${chatIdRef.value}/members`]),
      {
        properties: {
          value: {
            required: ["activity", "type", "member"],
            properties: {
              activity: { const: "Add" },
              type: { const: "Member" },
              member: { type: "string" },
            },
          },
        },
      },
    );

    // Unique member actors
    const memberActors = computed(() => [
      ...new Set(memberObjects.value.map((o) => o.value.member)),
    ]);

    // Discover profiles for members
    const { objects: profileObjects } = useGraffitiDiscover(
      computed(() => memberActors.value.map((a) => `${a}/profile`)),
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

    // Resolve handles for actors
    const actorHandles = ref({});

    async function resolveHandle(actor) {
      if (actorHandles.value[actor] !== undefined) return;
      actorHandles.value[actor] = null;
      try {
        const handle = await graffiti.actorToHandle(actor);
        actorHandles.value[actor] = handle;
      } catch {
        actorHandles.value[actor] = null;
      }
    }

    const members = computed(() => {
      return memberActors.value.map((actor) => {
        const profile = profileObjects.value
          .filter((p) => p.actor === actor)
          .toSorted((a, b) => b.value.published - a.value.published)[0];
        const displayName = profile?.value.displayName || null;
        // Trigger handle resolution
        if (!displayName) resolveHandle(actor);
        return {
          actor,
          displayName,
          handle: actorHandles.value[actor] || null,
        };
      });
    });

    function getInitial(member) {
      const name = member.displayName || member.handle || member.actor;
      return (name || "?").substring(0, 1).toUpperCase();
    }

    async function inviteMember() {
      const raw = inviteHandle.value.trim();
      if (!raw) return;
      isInviting.value = true;
      inviteError.value = "";
      try {
        // Strip any trailing .graffiti.actor if user included it
        const handle = raw.replace(/\.graffiti\.actor$/, "");
        const actor = await graffiti.handleToActor(handle);
        if (!actor) {
          inviteError.value = `Could not find user "${handle}"`;
          return;
        }

        if (memberActors.value.includes(actor)) {
          inviteError.value = "Already a member";
          return;
        }

        await graffiti.post(
          {
            value: {
              activity: "Add",
              type: "Member",
              member: actor,
              published: Date.now(),
            },
            channels: [`${chatIdRef.value}/members`],
          },
          session.value,
        );

        inviteHandle.value = "";
        showInviteForm.value = false;
      } catch (err) {
        inviteError.value = err?.message || "Failed to invite";
      } finally {
        isInviting.value = false;
      }
    }

    return {
      members,
      showInviteForm,
      inviteHandle,
      isInviting,
      inviteError,
      inviteMember,
      getInitial,
    };
  },
};
