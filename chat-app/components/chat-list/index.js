import { ref, computed, watchEffect } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { componentFromFolder } from "../component-loader.js";

const NotificationBadge = componentFromFolder("../notification-badge", import.meta.url);

// for now just using the shared channel to discover chats from studio
// later, chats would be discovered from:
// user's personal "/chats" channel (chats user created)
// user's "/inbox" channel (chats user was invited to)
const TEMP_SHARED_CHANNEL = "designftw-26";

export default {
  components: { NotificationBadge },
  setup() {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter();

    const newChatTitle = ref("");
    const isCreatingChat = ref(false);
    const showNewChatForm = ref(false);
    const searchQuery = ref("");

    // Fetch user settings to control message preview display
    const showMessagePreview = ref(true);
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

    // Sync settings from Graffiti
    watchEffect(() => {
      if (!session.value?.actor) return;
      const latest = settingsObjects.value
        .filter((o) => o.actor === session.value?.actor)
        .toSorted((a, b) => b.value.published - a.value.published)[0];
      if (latest) {
        showMessagePreview.value = latest.value.showMessagePreview ?? true;
      }
    });

    // Discover chats from user's personal channels
    const { objects: chatObjects, isFirstPoll: areChatsLoading } =
      useGraffitiDiscover(
        computed(() => 
          session.value?.actor 
            ? [`${session.value.actor}/chats`, `${session.value.actor}/inbox`]
            : []
        ),
        {
          properties: {
            value: {
              required: ["activity", "type", "title", "channel", "published"],
              properties: {
                activity: { const: "Create" },
                type: { const: "Chat" },
                title: { type: "string" },
                channel: { type: "string" },
                published: { type: "number" },
              },
            },
          },
        },
        undefined,
        true,
      );

    // Discover messages for all chats
    const chatChannels = computed(() =>
      chatObjects.value.map((c) => c.value.channel),
    );

    const { objects: allMessageObjects, isFirstPoll: areMessagesLoading } = useGraffitiDiscover(
      chatChannels,
      {
        properties: {
          value: {
            required: ["activity", "type", "content", "published"],
            properties: {
              activity: { const: "Create" },
              type: { const: "Message" },
              content: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
      undefined,
      true,
    );

    // Discover pages for all chats
    const { objects: allPageObjects, isFirstPoll: arePagesLoading } = useGraffitiDiscover(
      computed(() => 
        session.value?.actor 
          ? [`${session.value.actor}/page-inbox`]
          : []
      ),
      {
        properties: {
          value: {
            required: [
              "activity",
              "type",
              "title",
              "channel",
              "parentChatId",
              "published",
            ],
            properties: {
              activity: { const: "Create" },
              type: { const: "Page" },
              title: { type: "string" },
              channel: { type: "string" },
              parentChatId: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
      undefined,
      true,
    );

    // Get page channels for discovering page messages
    const pageChannels = computed(() =>
      allPageObjects.value.map((p) => p.value.channel),
    );

    // Discover messages for all pages
    const { objects: allPageMessageObjects, isFirstPoll: arePageMessagesLoading } = useGraffitiDiscover(
      pageChannels,
      {
        properties: {
          value: {
            required: ["activity", "type", "content", "published"],
            properties: {
              activity: { const: "Create" },
              type: { const: "Message" },
              content: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
      undefined,
      true,
    );

    // Discover read states for all messages (chat + page messages)
    const messageUrls = computed(() => [
      ...allMessageObjects.value.map((m) => m.url),
      ...allPageMessageObjects.value.map((m) => m.url),
    ]);
    const readStateChannels = computed(() =>
      messageUrls.value.map((url) => `${url}/read-by`),
    );

    const { objects: readStateObjects, isFirstPoll: areReadStatesLoading } = useGraffitiDiscover(
      readStateChannels,
      {
        properties: {
          value: {
            required: ["activity", "type", "reader", "messageUrl", "published"],
            properties: {
              activity: { const: "Create" },
              type: { const: "ReadState" },
              reader: { type: "string" },
              messageUrl: { type: "string" },
              published: { type: "number" },
            },
          },
        },
      },
      undefined,
      true,
    );

    // Combined loading state - wait for all data sources before showing UI to prevent flickering
    const isLoading = computed(() =>
      areChatsLoading.value ||
      areMessagesLoading.value ||
      arePagesLoading.value ||
      arePageMessagesLoading.value ||
      areReadStatesLoading.value ||
      pendingHandles.value.size > 0,
    );

    // Get unique actors from all messages to fetch their profiles
    const uniqueActors = computed(() => [
      ...new Set(allMessageObjects.value.map((m) => m.actor)),
    ]);

    const { objects: profileObjects } = useGraffitiDiscover(
      computed(() => uniqueActors.value.map((a) => `${a}/profile`)),
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

    // Cache for resolved handles
    const handleCache = ref(new Map());
    const pendingHandles = ref(new Set());
    
    // Resolve handle for an actor (with caching)
    async function getActorHandle(actor) {
      if (handleCache.value.has(actor)) {
        return handleCache.value.get(actor);
      }
      if (pendingHandles.value.has(actor)) {
        return null; // Already resolving
      }
      
      pendingHandles.value.add(actor);
      try {
        const handle = await graffiti.actorToHandle(actor);
        handleCache.value.set(actor, handle);
        return handle;
      } catch {
        const fallback = actor.split(".")[0];
        handleCache.value.set(actor, fallback);
        return fallback;
      } finally {
        pendingHandles.value.delete(actor);
      }
    }
    
    // Map actor to display name
    const actorDisplayNames = computed(() => {
      const map = new Map();
      for (const actor of uniqueActors.value) {
        const profile = profileObjects.value
          .filter((p) => p.actor === actor)
          .toSorted((a, b) => b.value.published - a.value.published)[0];
        
        if (profile?.value.displayName) {
          map.set(actor, profile.value.displayName);
        } else {
          // Trigger handle resolution if not cached
          if (!handleCache.value.has(actor)) {
            getActorHandle(actor);
          }
          map.set(actor, handleCache.value.get(actor) || actor.split(".")[0]);
        }
      }
      return map;
    });

    // Compute latest message per chat (including page messages)
    const chatLatestMessages = computed(() => {
      const map = new Map();
      for (const chat of chatObjects.value) {
        // Get chat messages
        const chatMessages = allMessageObjects.value
          .filter((m) => m.channels.includes(chat.value.channel))
          .toSorted((a, b) => b.value.published - a.value.published);
        
        // Get pages for this chat where user is a member
        const chatPagesForThisChat = allPageObjects.value.filter(
          (p) => p.value.parentChatId === chat.value.channel &&
                (p.value.members || []).includes(session.value?.actor),
        );
        const pageChannelsForThisChat = chatPagesForThisChat.map((p) => p.value.channel);
        
        // Get messages from all pages in this chat
        const pageMessages = allPageMessageObjects.value.filter((m) =>
          pageChannelsForThisChat.some((ch) => m.channels.includes(ch)),
        ).toSorted((a, b) => b.value.published - a.value.published);
        
        // Combine and find the most recent message overall
        const allMessages = [...chatMessages, ...pageMessages]
          .toSorted((a, b) => b.value.published - a.value.published);
        
        if (allMessages.length > 0) {
          const latest = allMessages[0];
          const isPageMessage = pageMessages.some(m => m.url === latest.url);
          let pageName = null;
          
          if (isPageMessage) {
            // Find which page this message belongs to
            const page = chatPagesForThisChat.find(p => 
              latest.channels.includes(p.value.channel)
            );
            pageName = page?.value.title || null;
          }
          
          map.set(chat.value.channel, {
            message: latest,
            senderName: actorDisplayNames.value.get(latest.actor) || "Unknown",
            pageName: pageName,
          });
        }
      }
      return map;
    });

    const sortedChats = computed(() => {
      const q = searchQuery.value.trim().toLowerCase();
      const chats = q
        ? chatObjects.value.filter((chat) =>
            chat.value.title.toLowerCase().includes(q),
          )
        : chatObjects.value;
      return chats.toSorted((a, b) => {
        const aLatest = chatLatestMessages.value.get(a.value.channel);
        const bLatest = chatLatestMessages.value.get(b.value.channel);
        const aTime = aLatest?.message.value.published || a.value.published;
        const bTime = bLatest?.message.value.published || b.value.published;
        return bTime - aTime;
      });
    });

    async function createChat() {
      if (!newChatTitle.value.trim()) return;

      isCreatingChat.value = true;
      try {
        const chatChannel = crypto.randomUUID();

        // Post chat to creator's /chats channel
        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Chat",
              title: newChatTitle.value,
              channel: chatChannel,
              owner: session.value.actor,
              published: Date.now(),
            },
            channels: [`${session.value.actor}/chats`],
          },
          session.value,
        );

        // Auto-add creator as first member
        await graffiti.post(
          {
            value: {
              activity: "Add",
              type: "Member",
              member: session.value.actor,
              published: Date.now(),
            },
            channels: [`${chatChannel}/members`],
          },
          session.value,
        );

        newChatTitle.value = "";
        showNewChatForm.value = false;
      } finally {
        isCreatingChat.value = false;
      }
    }

    function openChat(chat) {
      const hasNotif = hasUnreadPageMessages(chat);
      router.push({
        name: "chat",
        params: { chatId: chat.value.channel },
        query: hasNotif ? { pageNotif: '1' } : {},
        state: { 
          chat: {
            title: chat.value.title,
            owner: chat.value.owner,
            channel: chat.value.channel,
          },
        },
      });
    }

    function formatTime(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    }

    function formatTimeSince(timestamp) {
      const now = Date.now();
      const diff = now - timestamp;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `${days}d`;
      if (hours > 0) return `${hours}h`;
      if (minutes > 0) return `${minutes}m`;
      return "now";
    }

    function getLatestMessageInfo(chat) {
      return chatLatestMessages.value.get(chat.value.channel);
    }

    // Calculate unread count for each chat (including page messages)
    function getUnreadCount(chat) {
      if (!session.value?.actor) return 0;

      // Get chat messages
      const chatMessages = allMessageObjects.value.filter((m) =>
        m.channels.includes(chat.value.channel),
      );

      // Get pages for this chat where user is a member
      const chatPagesForThisChat = allPageObjects.value.filter(
        (p) => p.value.parentChatId === chat.value.channel &&
              (p.value.members || []).includes(session.value.actor),
      );
      const pageChannelsForThisChat = chatPagesForThisChat.map((p) => p.value.channel);

      // Get messages from all pages in this chat
      const pageMessages = allPageMessageObjects.value.filter((m) =>
        pageChannelsForThisChat.some((ch) => m.channels.includes(ch)),
      );

      // Combine chat and page messages
      const allMessages = [...chatMessages, ...pageMessages];

      const unreadMessages = allMessages.filter((msg) => {
        // Don't count own messages as unread
        if (msg.actor === session.value.actor) return false;

        // Check if current user has marked this message as read
        const hasReadState = readStateObjects.value.some(
          (rs) =>
            rs.value.messageUrl === msg.url &&
            rs.value.reader === session.value.actor,
        );
        return !hasReadState;
      });

      return unreadMessages.length;
    }

    // Check if chat has unread page messages
    function hasUnreadPageMessages(chat) {
      if (!session.value?.actor) return false;

      // Get pages for this chat where user is a member
      const chatPagesForThisChat = allPageObjects.value.filter(
        (p) => p.value.parentChatId === chat.value.channel &&
              (p.value.members || []).includes(session.value.actor),
      );
      const pageChannelsForThisChat = chatPagesForThisChat.map((p) => p.value.channel);

      // Get messages from all pages in this chat
      const pageMessages = allPageMessageObjects.value.filter((m) =>
        pageChannelsForThisChat.some((ch) => m.channels.includes(ch)),
      );

      const unreadPageMessages = pageMessages.filter((msg) => {
        if (msg.actor === session.value.actor) return false;
        const hasReadState = readStateObjects.value.some(
          (rs) =>
            rs.value.messageUrl === msg.url &&
            rs.value.reader === session.value.actor,
        );
        return !hasReadState;
      });

      return unreadPageMessages.length > 0;
    }

    function getInitials(title) {
      return (title || "?").substring(0, 2).toUpperCase();
    }

    return {
      newChatTitle,
      isCreatingChat,
      showNewChatForm,
      searchQuery,
      isLoading,
      sortedChats,
      showMessagePreview,
      createChat,
      openChat,
      formatTime,
      formatTimeSince,
      getInitials,
      getLatestMessageInfo,
      getUnreadCount,
    };
  },
};
