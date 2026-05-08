import { ref, computed, toRef, watchEffect, watch, onMounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import { componentFromFolder } from "../component-loader.js";

const TEMP_SHARED_CHANNEL = "designftw-26";

const ChatMessage = componentFromFolder("../chat-message", import.meta.url);
const MembersList = componentFromFolder("../members-list", import.meta.url);
const PagesList = componentFromFolder("../pages-list", import.meta.url);
const ChatSettings = componentFromFolder("../chat-settings", import.meta.url);
const BookmarksList = componentFromFolder("../bookmarks-list", import.meta.url);
const Avatar = componentFromFolder("../avatar", import.meta.url);
const UserProfile = componentFromFolder("../user-profile", import.meta.url);

export default {
  components: { ChatMessage, MembersList, PagesList, ChatSettings, BookmarksList, Avatar, UserProfile },
  props: {
    chatId: { type: String, required: true },
  },
  setup(props) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const router = useRouter();

    const myMessage = ref("");
    const isSendingMessage = ref(false);
    const showMembersList = ref(false);
    const showPagesList = ref(false);
    const showBookmarksList = ref(false);
    const profileActor = ref(null);
    const showChatSettings = ref(false);
    const replyingTo = ref(null);
    const messagesContainer = ref(null);
    const messageInput = ref(null);

    const chatIdRef = toRef(props, "chatId");

    // Get chat data from router state if available (for immediate display)
    const initialChatData = router.currentRoute.value.state?.chat || null;
    const chatTitleRef = ref(initialChatData?.title || "");
    const chatOwnerRef = ref(initialChatData?.owner || null);
    const chatIconRef = ref(initialChatData?.icon || "");
    const chatDescriptionRef = ref(initialChatData?.description || "");
    // Header is loaded immediately if we have initial data, otherwise wait for discovery
    const isChatLoaded = ref(!!initialChatData);

    // Get page notifications flag from query parameter
    const hasPageNotifications = ref(router.currentRoute.value.query.pageNotif === '1');
    
    // Clear the query parameter after reading it
    if (router.currentRoute.value.query.pageNotif) {
      router.replace({
        name: 'chat',
        params: { chatId: chatIdRef.value },
      });
    }

    // Discover messages in this chat's channel.
    const { objects: messageObjects, isFirstPoll } =
      useGraffitiDiscover(
        computed(() => [chatIdRef.value]),
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

    const hasScrolledOnMount = ref(false);

    const areMessagesLoading = computed(
      () => (isFirstPoll.value && messageObjects.value.length === 0) || pendingHandles.value.size > 0,
    );

    const sortedMessages = computed(() =>
      messageObjects.value.toSorted(
        (a, b) => a.value.published - b.value.published,
      ),
    );

    // Discover read states for all messages in this chat
    const messageUrls = computed(() => messageObjects.value.map((m) => m.url));
    const readStateChannels = computed(() =>
      messageUrls.value.map((url) => `${url}/read-by`),
    );

    const { objects: readStateObjects } = useGraffitiDiscover(
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
    );


    // Discover per-user dismiss timestamps for bookmarks in this chat
    const { objects: dismissObjects, isFirstPoll: isDismissLoading } = useGraffitiDiscover(
      computed(() =>
        session.value?.actor
          ? [`${session.value.actor}/${chatIdRef.value}/bookmark-dismiss`]
          : [],
      ),
      {
        properties: {
          value: {
            required: ["activity", "type", "dismissedAt"],
            properties: {
              activity: { const: "Create" },
              type: { const: "BookmarkDismiss" },
              dismissedAt: { type: "number" },
            },
          },
        },
      },
    );

    const dismissedAt = computed(() =>
      dismissObjects.value.length === 0
        ? 0
        : Math.max(...dismissObjects.value.map((d) => d.value.dismissedAt)),
    );

    // Discover bookmarks shared across all members of this chat
    const { objects: bookmarkObjects } = useGraffitiDiscover(
      computed(() => [`${chatIdRef.value}/bookmarks`]),
      {
        properties: {
          value: {
            required: ["activity", "type", "messageUrl", "bookmarkedAt"],
            properties: {
              activity: { const: "Create" },
              type: { const: "Bookmark" },
              messageUrl: { type: "string" },
              bookmarkedAt: { type: "number" },
            },
          },
        },
      },
    );

    // Get unique actors from messages to fetch their profiles
    const uniqueActors = computed(() => [
      ...new Set(sortedMessages.value.map((m) => m.actor)),
    ]);

    // Discover profiles for all actors in this chat
    const { objects: profileObjects } = useGraffitiDiscover(
      computed(() =>
        uniqueActors.value.map((actor) => `${actor}/profile`),
      ),
      {
        properties: {
          value: {
            required: ["activity", "type"],
            properties: {
              activity: { const: "Update" },
              type: { const: "Profile" },
              displayName: { type: "string" },
            },
          },
        },
      },
    );

    // Cache for resolved handles
    const handleCache = ref(new Map());
    const pendingHandles = ref(new Set());

    async function getActorHandle(actor) {
      if (handleCache.value.has(actor)) return handleCache.value.get(actor);
      if (pendingHandles.value.has(actor)) return null;
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

    // Eagerly kick off handle resolution whenever the actor set changes.
    // Runs pre-render so pendingHandles is non-empty before areMessagesLoading
    // is evaluated, preventing any frame where messages render without names.
    watchEffect(() => {
      for (const actor of uniqueActors.value) {
        if (!handleCache.value.has(actor) && !pendingHandles.value.has(actor)) {
          getActorHandle(actor);
        }
      }
    });

    const actorDisplayNames = computed(() => {
      const map = new Map();
      for (const actor of uniqueActors.value) {
        const profile = profileObjects.value
          .filter((p) => p.actor === actor)
          .toSorted((a, b) => b.value.published - a.value.published)[0];
        if (profile?.value.displayName) {
          map.set(actor, profile.value.displayName);
        } else {
          if (!handleCache.value.has(actor)) getActorHandle(actor);
          map.set(actor, handleCache.value.get(actor) || actor.split(".")[0]);
        }
      }
      return map;
    });

    const actorPhotoUrls = computed(() => {
      const map = new Map();
      for (const actor of uniqueActors.value) {
        const profile = profileObjects.value
          .filter((p) => p.actor === actor)
          .toSorted((a, b) => b.value.published - a.value.published)[0];
        if (profile?.value.icon) map.set(actor, profile.value.icon);
      }
      return map;
    });

    // Enrich messages with block start/end indicators
    const enrichedMessages = computed(() =>
      sortedMessages.value.map((msg, index) => {
        const prevMsg = index > 0 ? sortedMessages.value[index - 1] : null;
        const nextMsg = index < sortedMessages.value.length - 1 ? sortedMessages.value[index + 1] : null;
        const isBlockStart = !prevMsg || prevMsg.actor !== msg.actor;
        const isBlockEnd = !nextMsg || nextMsg.actor !== msg.actor;
        const displayName = actorDisplayNames.value.get(msg.actor) || null;
        return { message: msg, isBlockStart, isBlockEnd, displayName };
      }),
    );

    // Discover chat metadata only if we don't have initial data (for direct navigation/refresh)
    const shouldDiscoverChat = computed(() => !initialChatData);
    
    const { objects: chatMetaObjects } = useGraffitiDiscover(
      computed(() => 
        shouldDiscoverChat.value && session.value?.actor
          ? [`${session.value.actor}/chats`, `${session.value.actor}/inbox`]
          : []
      ),
      {
        properties: {
          value: {
            required: ["activity", "type", "title", "channel"],
            properties: {
              activity: { const: "Create" },
              type: { const: "Chat" },
              title: { type: "string" },
              channel: { type: "string" },
            },
          },
        },
      },
    );

    // Update chat title from discovery only if needed (direct navigation without router state)
    watchEffect(() => {
      if (!shouldDiscoverChat.value) return;
      
      const match = chatMetaObjects.value.find(
        (c) => c.value.channel === chatIdRef.value,
      );
      if (match?.value.title) {
        chatTitleRef.value = match.value.title;
        chatOwnerRef.value = match.value.owner || null;
        chatIconRef.value = match.value.icon || "";
        chatDescriptionRef.value = match.value.description || "";
        isChatLoaded.value = true;
      }
    });

    const chatTitle = computed(() => chatTitleRef.value);
    const chatOwner = computed(() => chatOwnerRef.value);
    const chatIcon = computed(() => chatIconRef.value);
    const chatDescription = computed(() => chatDescriptionRef.value);

    // Open pages list if query parameter is set
    watch(
      () => router.currentRoute.value.query.openPagesList,
      (shouldOpen) => {
        if (shouldOpen === 'true') {
          showPagesList.value = true;
          // Clear the query parameter
          router.replace({ 
            name: "chat", 
            params: { chatId: chatIdRef.value } 
          });
        }
      },
      { immediate: true }
    );

    // Track in-flight posts to avoid duplicate read states from concurrent watchEffect firings
    const pendingReadUrls = new Set();

    async function markMessagesAsRead() {
      if (!session.value?.actor || messageObjects.value.length === 0) return;

      const messagesToMarkRead = messageObjects.value.filter((msg) => {
        if (pendingReadUrls.has(msg.url)) return false;
        const hasReadState = readStateObjects.value.some(
          (rs) =>
            rs.value.messageUrl === msg.url &&
            rs.value.reader === session.value.actor,
        );
        return !hasReadState && msg.actor !== session.value.actor;
      });

      if (messagesToMarkRead.length === 0) return;
      messagesToMarkRead.forEach((msg) => pendingReadUrls.add(msg.url));

      try {
        await Promise.all(
          messagesToMarkRead.map((msg) =>
            graffiti.post(
              {
                value: {
                  activity: "Create",
                  type: "ReadState",
                  reader: session.value.actor,
                  messageUrl: msg.url,
                  published: Date.now(),
                },
                channels: [`${msg.url}/read-by`],
              },
              session.value,
            ),
          ),
        );
      } catch (err) {
        console.error("Error marking messages as read:", err);
        messagesToMarkRead.forEach((msg) => pendingReadUrls.delete(msg.url));
      }
    }

    // Scroll to bottom on mount when messages are loaded
    onMounted(() => {
      markMessagesAsRead();
    });

    // Watch for initial messages load and scroll to bottom
    watchEffect(() => {
      if (!hasScrolledOnMount.value && !isFirstPoll.value && enrichedMessages.value.length > 0) {
        nextTick(() => {
          if (messagesContainer.value) {
            messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
            hasScrolledOnMount.value = true;
          }
        });
      }
    });

    watchEffect(() => {
      // Re-run when messages or read states change
      if (messageObjects.value.length > 0 && readStateObjects.value) {
        markMessagesAsRead();
      }
    });

    function handleReply(replyInfo) {
      replyingTo.value = replyInfo;
    }

    function openUserProfile(actor) {
      profileActor.value = actor;
    }

    const shouldScrollOnNextUpdate = ref(false);

    function scrollToBottom() {
      if (messagesContainer.value) {
        setTimeout(() => {
          if (messagesContainer.value) {
            messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
          }
        }, 100);
      }
    }

    watchEffect(() => {
      if (shouldScrollOnNextUpdate.value && enrichedMessages.value.length > 0) {
        scrollToBottom();
        shouldScrollOnNextUpdate.value = false;
      }
    });

    async function sendMessage() {
      if (!myMessage.value.trim() || !chatIdRef.value) return;

      isSendingMessage.value = true;
      try {
        const msgValue = {
          activity: "Create",
          type: "Message",
          content: myMessage.value,
          target: chatIdRef.value,
          published: Date.now(),
        };
        if (replyingTo.value) {
          msgValue.replyTo = {
            url: replyingTo.value.url,
            content: replyingTo.value.content,
            actor: replyingTo.value.actor,
          };
        }
        await graffiti.post(
          { value: msgValue, channels: [chatIdRef.value] },
          session.value,
        );
        myMessage.value = "";
        replyingTo.value = null;
        shouldScrollOnNextUpdate.value = true;
      } finally {
        isSendingMessage.value = false;
        nextTick(() => messageInput.value?.focus());
      }
    }

    function back() {
      router.push({ name: "home" });
    }

    function getInitials(title) {
      return (title || "?").substring(0, 2).toUpperCase();
    }

    function handleChatSettingsUpdated(data) {
      chatTitleRef.value = data.title;
      chatIconRef.value = data.icon;
      chatDescriptionRef.value = data.description;
    }

    // Bookmarks visible to this user (posted after their last dismiss).
    // Return empty until the dismiss poll completes so we never flash dismissed bookmarks.
    const visibleBookmarkObjects = computed(() => {
      if (isDismissLoading.value) return [];
      return bookmarkObjects.value.filter(
        (bm) => bm.value.bookmarkedAt > dismissedAt.value,
      );
    });

    // Map messageUrl -> most recent bookmark object for that message (all bookmarks, dismiss does not affect the bubble indicator)
    const bookmarksByUrl = computed(() => {
      const map = new Map();
      for (const bm of bookmarkObjects.value) {
        const existing = map.get(bm.value.messageUrl);
        if (!existing || bm.value.bookmarkedAt > existing.value.bookmarkedAt) {
          map.set(bm.value.messageUrl, bm);
        }
      }
      return map;
    });

    // The bookmark added most recently (highest bookmarkedAt), after dismiss
    const latestBookmark = computed(() => {
      if (visibleBookmarkObjects.value.length === 0) return null;
      return visibleBookmarkObjects.value.toSorted(
        (a, b) => b.value.bookmarkedAt - a.value.bookmarkedAt,
      )[0];
    });

    const stickyBookmarkedMessage = computed(() => {
      if (!latestBookmark.value) return null;
      return (
        messageObjects.value.find(
          (m) => m.url === latestBookmark.value.value.messageUrl,
        ) || null
      );
    });

    const stickyDisplayName = computed(() => {
      if (!stickyBookmarkedMessage.value) return null;
      return actorDisplayNames.value.get(stickyBookmarkedMessage.value.actor) ?? null;
    });

    const enrichedBookmarks = computed(() =>
      bookmarkObjects.value
        .toSorted((a, b) => b.value.bookmarkedAt - a.value.bookmarkedAt)
        .map((bm) => {
          const message = messageObjects.value.find(
            (m) => m.url === bm.value.messageUrl,
          );
          const actor = message?.actor || bm.value.messageActor;
          return {
            bookmarkObject: bm,
            message,
            senderName: actor ? actorDisplayNames.value.get(actor) || null : null,
            content: message?.value.content || bm.value.messageContent || "",
            bookmarkedAt: bm.value.bookmarkedAt,
            messageUrl: bm.value.messageUrl,
          };
        }),
    );

    async function dismissBookmarks() {
      if (!session.value?.actor) return;
      try {
        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "BookmarkDismiss",
              channelId: chatIdRef.value,
              dismissedAt: Date.now(),
            },
            channels: [
              `${session.value.actor}/${chatIdRef.value}/bookmark-dismiss`,
            ],
          },
          session.value,
        );
      } catch (err) {
        console.error("Error dismissing bookmarks:", err);
      }
    }

    async function handleBookmark(message) {
      if (!session.value?.actor) return;
      try {
        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Bookmark",
              messageUrl: message.url,
              messageContent: message.value.content,
              messageActor: message.actor,
              channelId: chatIdRef.value,
              bookmarkedAt: Date.now(),
            },
            channels: [`${chatIdRef.value}/bookmarks`],
          },
          session.value,
        );
      } catch (err) {
        console.error("Error bookmarking:", err);
      }
    }

    async function handleUnbookmark(bookmarkObject) {
      if (!session.value?.actor) return;
      try {
        await graffiti.delete(bookmarkObject, session.value);
      } catch (err) {
        console.error("Error removing bookmark:", err);
      }
    }

    function scrollToMessage(messageUrl) {
      if (!messagesContainer.value) return;
      showBookmarksList.value = false;
      nextTick(() => {
        const els =
          messagesContainer.value?.querySelectorAll("[data-message-url]");
        if (!els) return;
        for (const el of els) {
          if (el.dataset.messageUrl === messageUrl) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            break;
          }
        }
      });
    }

    return {
      myMessage,
      isSendingMessage,
      showMembersList,
      showPagesList,
      showBookmarksList,
      profileActor,
      replyingTo,
      bookmarksByUrl,
      stickyBookmarkedMessage,
      stickyDisplayName,
      enrichedBookmarks,
      handleBookmark,
      handleUnbookmark,
      dismissBookmarks,
      scrollToMessage,
      areMessagesLoading,
      enrichedMessages,
      readStateObjects,
      actorDisplayNames,
      uniqueActors,
      chatTitle,
      chatOwner,
      chatIcon,
      chatDescription,
      isChatLoaded,
      chatId: chatIdRef,
      actorPhotoUrls,
      showChatSettings,
      sendMessage,
      handleReply,
      openUserProfile,
      handleChatSettingsUpdated,
      back,
      getInitials,
      hasPageNotifications,
      messagesContainer,
      messageInput,
      hasScrolledOnMount,
    };
  },
};
