import { ref, computed, toRef } from "vue";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

const ADD_SCHEMA = {
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
};

const REMOVE_SCHEMA = {
  properties: {
    value: {
      required: ["activity", "type", "member"],
      properties: {
        activity: { const: "Remove" },
        type: { const: "Member" },
        member: { type: "string" },
      },
    },
  },
};

// Latest-record-wins: returns active actor list given add + remove objects.
// Only removes authored by ownerActor are treated as authoritative.
function resolveActiveActors(addObjects, removeObjects, ownerActor) {
  const latest = new Map(); // actor → { type, published }

  for (const obj of addObjects) {
    const actor = obj.value.member;
    const pub = obj.value.published;
    const cur = latest.get(actor);
    if (!cur || pub > cur.published) latest.set(actor, { type: "Add", published: pub });
  }

  if (ownerActor) {
    for (const obj of removeObjects) {
      if (obj.actor !== ownerActor) continue;
      const actor = obj.value.member;
      const pub = obj.value.published;
      const cur = latest.get(actor);
      if (!cur || pub > cur.published) latest.set(actor, { type: "Remove", published: pub });
    }
  }

  return [...latest.entries()]
    .filter(([, r]) => r.type === "Add")
    .map(([actor]) => actor);
}

export default {
  props: {
    chatId:       { type: String, required: true },
    chatOwner:    { type: String, default: null },
    chatTitle:    { type: String, default: "" },
    // When set this is a page members panel; show parent-chat member picker instead of handle input
    parentChatId: { type: String, default: null },
  },
  emits: ["close"],
  setup(props) {
    const graffiti = useGraffiti();
    const session  = useGraffitiSession();
    const chatIdRef = toRef(props, "chatId");

    const showInviteForm  = ref(false);
    const inviteHandle    = ref("");
    const isInviting      = ref(false);
    const inviteError     = ref("");
    const confirmingRemove = ref(null);
    const removingActor    = ref(null);
    const addingActor      = ref(null);

    const isOwner = computed(
      () => !!session.value?.actor && props.chatOwner === session.value.actor,
    );
    const isPage = computed(() => !!props.parentChatId);

    // ── Current chat / page member records ─────────────────────────────────
    const {
      objects: memberObjects,
      isFirstPoll: isMembersLoading,
      poll: pollMembers,
    } = useGraffitiDiscover(computed(() => [`${chatIdRef.value}/members`]), ADD_SCHEMA);

    const {
      objects: removeObjects,
      isFirstPoll: isRemovesLoading,
      poll: pollRemoves,
    } = useGraffitiDiscover(computed(() => [`${chatIdRef.value}/members`]), REMOVE_SCHEMA);

    // Block the UI until BOTH arrives — prevents removed-member flash
    const isLoading = computed(() => isMembersLoading.value || isRemovesLoading.value);

    const memberActors = computed(() =>
      resolveActiveActors(memberObjects.value, removeObjects.value, props.chatOwner),
    );

    // ── Parent chat member records (page mode only) ─────────────────────────
    const { objects: parentMemberObjects } = useGraffitiDiscover(
      computed(() => (isPage.value ? [`${props.parentChatId}/members`] : [])),
      ADD_SCHEMA,
    );

    // Members of the parent chat not yet in this page — available to add
    const invitableParentActors = computed(() => {
      if (!isPage.value) return [];
      const inPage = new Set(memberActors.value);
      return [...new Set(parentMemberObjects.value.map((o) => o.value.member))].filter(
        (a) => !inPage.has(a),
      );
    });

    // ── Profile discovery ──────────────────────────────────────────────────
    const { objects: profileObjects } = useGraffitiDiscover(
      computed(() => {
        const all = new Set([...memberActors.value, ...invitableParentActors.value]);
        return [...all].map((a) => `${a}/profile`);
      }),
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

    const actorHandles = ref({});
    async function resolveHandle(actor) {
      if (actorHandles.value[actor] !== undefined) return;
      actorHandles.value[actor] = null;
      try {
        actorHandles.value[actor] = await graffiti.actorToHandle(actor);
      } catch {
        actorHandles.value[actor] = null;
      }
    }

    function shortLabel(displayName, handle) {
      if (displayName) return displayName;
      if (handle) return handle.replace(/\.graffiti\.actor$/, "");
      return "…";
    }

    function buildMemberInfo(actor) {
      const profile = profileObjects.value
        .filter((p) => p.actor === actor)
        .toSorted((a, b) => b.value.published - a.value.published)[0];
      const displayName = profile?.value.displayName || null;
      const handle = actorHandles.value[actor] || null;
      if (!displayName) resolveHandle(actor);
      return {
        actor,
        displayName,
        handle,
        label: shortLabel(displayName, handle),
        isCurrentUser: actor === session.value?.actor,
        isOwner: actor === props.chatOwner,
      };
    }

    const members = computed(() => memberActors.value.map(buildMemberInfo));

    const invitableParentMembers = computed(() =>
      invitableParentActors.value.map(buildMemberInfo),
    );

    function getInitial(member) {
      const name = member.displayName || member.handle || member.actor;
      return (name || "?").substring(0, 1).toUpperCase();
    }

    async function refreshLists() {
      await Promise.all([pollMembers(), pollRemoves()]);
    }

    async function removeMember(actor) {
      confirmingRemove.value = null;
      removingActor.value = actor;
      try {
        await graffiti.post(
          {
            value: { activity: "Remove", type: "Member", member: actor, published: Date.now() },
            channels: [`${chatIdRef.value}/members`],
          },
          session.value,
        );
        await refreshLists();
      } catch (err) {
        console.error("Failed to remove member:", err);
      } finally {
        removingActor.value = null;
      }
    }

    // Chat mode: invite by Graffiti handle
    async function inviteMember() {
      const raw = inviteHandle.value.trim();
      if (!raw) return;
      isInviting.value = true;
      inviteError.value = "";
      try {
        const handle = raw.endsWith(".graffiti.actor") ? raw : `${raw}.graffiti.actor`;
        const actor = await graffiti.handleToActor(handle);
        if (!actor) {
          inviteError.value = `Could not find user "${handle}"`;
          return;
        }
        if (memberActors.value.includes(actor)) {
          inviteError.value = "Already a member";
          return;
        }
        addingActor.value = actor;
        await graffiti.post(
          {
            value: { activity: "Add", type: "Member", member: actor, published: Date.now() },
            channels: [`${chatIdRef.value}/members`],
          },
          session.value,
        );
        await refreshLists();
        // Best-effort inbox delivery
        graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Chat",
              title: props.chatTitle,
              channel: chatIdRef.value,
              owner: props.chatOwner,
              published: Date.now(),
            },
            channels: [`${actor}/inbox`],
          },
          session.value,
        ).catch((err) => console.warn("Could not deliver chat to invitee inbox:", err));
        inviteHandle.value = "";
        showInviteForm.value = false;
      } catch (err) {
        console.error("Invite failed:", err);
        inviteError.value = err?.message || "Failed to invite";
      } finally {
        isInviting.value = false;
        addingActor.value = null;
      }
    }

    // Page mode: add a parent-chat member directly
    async function addPageMember(actor) {
      if (memberActors.value.includes(actor)) return;
      addingActor.value = actor;
      try {
        await graffiti.post(
          {
            value: { activity: "Add", type: "Member", member: actor, published: Date.now() },
            channels: [`${chatIdRef.value}/members`],
          },
          session.value,
        );
        await refreshLists();
      } catch (err) {
        console.error("Failed to add page member:", err);
      } finally {
        addingActor.value = null;
      }
    }

    return {
      members,
      isOwner,
      isPage,
      isLoading,
      confirmingRemove,
      removingActor,
      addingActor,
      showInviteForm,
      inviteHandle,
      isInviting,
      inviteError,
      invitableParentMembers,
      inviteMember,
      addPageMember,
      removeMember,
      getInitial,
    };
  },
};
