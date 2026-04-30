import { createApp, ref, computed } from "vue";
import { GraffitiLocal } from "@graffiti-garden/implementation-local";
// import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import {
  GraffitiPlugin,
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

function setup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  // for now just using the shared channel to discover chats from studio
  // later, chats would be discovered from:
  // user's personal "/chats" channel (chats user created)
  // user's "/inbox" channel (chats user was invited to)
  const TEMP_SHARED_CHANNEL = "designftw-26";
  
  const currentView = ref("chatList");
  const currentChatChannel = ref(null);
  const currentChatTitle = ref("");
  const myMessage = ref("");
  const newChatTitle = ref("");
  const userName = ref("");
  const isCreatingChat = ref(false);
  const isSendingMessage = ref(false);
  const isJoiningChat = ref(false);
  const isSavingProfile = ref(false);
  const showNewChatForm = ref(false);

  // discover chat objects
  // TODO: replace with user's personal channels once member invitations are implemented
  const { objects: chatObjects, isFirstPoll: areChatsLoading } = useGraffitiDiscover(
    [TEMP_SHARED_CHANNEL],
    {
      properties: {
        value: {
          required: ["activity", "type", "title", "channel", "published"],
          properties: {
            activity: { const: "Create" },
            type: { const: "Chat" },
            title: { type: "string" },
            channel: { type: "string" },
            // members: { type: "array" },
            published: { type: "number" },
          },
        },
      },
    },
    undefined, // add allowed list with member IDs for private chats
    true,
  );

  const sortedChats = computed(() => {
    return chatObjects.value.toSorted((a, b) => {
      return b.value.published - a.value.published;
    });
  });

  const { objects: messageObjects, isFirstPoll: areMessagesLoading } = useGraffitiDiscover(
    computed(() => currentChatChannel.value ? [currentChatChannel.value] : []),
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

  const sortedMessages = computed(() => {
    return messageObjects.value.toSorted((a, b) => {
      return a.value.published - b.value.published;
    });
  });

  // ACTION 1: Create Chat
  // Creates a new private chat with invited members
  async function createChat() {
    if (!newChatTitle.value.trim()) return;
    
    isCreatingChat.value = true;
    try {
      const chatChannel = crypto.randomUUID();
      
      // const invitedMembers = [...]; // Array of actor IDs
      
      await graffiti.post(
        {
          value: {
            activity: "Create",
            type: "Chat",
            title: newChatTitle.value,
            channel: chatChannel,
            // members: invitedMembers,
            published: Date.now(),
          },
          channels: [TEMP_SHARED_CHANNEL], // replace with [actorID/chats] and [memberID/inbox] for each member
          // allowed: [session.value.actor, ...invitedMembers]
        },
        session.value,
      );
      newChatTitle.value = "";
      showNewChatForm.value = false;
    } finally {
      isCreatingChat.value = false;
    }
  }

  // ACTION 3: Join/Accept Chat Invitation
  // Join an invited chat
  async function joinChat(chat) {
    isJoiningChat.value = true;
    try {
      // await graffiti.post({
      //   value: {
      //     activity: "Join",
      //     type: "Chat",
      //     target: chat.value.channel
      //   },
      //   channels: [chat.value.channel, `${session.value.actor}/chats`],
      //   allowed: [...chatMemberIds] // In chat channel
      //   // empty allowed list for personal tracking
      // }, session.value);
      
      currentChatChannel.value = chat.value.channel;
      currentChatTitle.value = chat.value.title;
      currentView.value = "chat";
    } finally {
      isJoiningChat.value = false;
    }
  }

  // ACTION 2: Send Message
  // Sends a private message visible only to chat members
  async function sendMessage() {
    if (!myMessage.value.trim() || !currentChatChannel.value) return;
    
    isSendingMessage.value = true;
    try {
      await graffiti.post(
        {
          value: {
            activity: "Create",
            type: "Message",
            content: myMessage.value,
            target: currentChatChannel.value,
            published: Date.now(),
          },
          channels: [currentChatChannel.value],
          // allowed: [...chatMemberIds]
        },
        session.value,
      );
      myMessage.value = "";
    } finally {
      isSendingMessage.value = false;
    }
  }

  const isDeleting = ref(new Set());
  async function deleteMessage(message) {
    isDeleting.value.add(message.url);
    try {
      await graffiti.delete(message, session.value);
    } finally {
      isDeleting.value.delete(message.url);
    }
  }

  function backToChatList() {
    currentView.value = "chatList";
    currentChatChannel.value = null;
    currentChatTitle.value = "";
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function getInitials(actor) {
    return actor.substring(0, 2).toUpperCase();
  }

  return {
    currentView,
    currentChatTitle,
    myMessage,
    newChatTitle,
    userName,
    areChatsLoading,
    areMessagesLoading,
    isCreatingChat,
    isSendingMessage,
    isJoiningChat,
    isSavingProfile,
    showNewChatForm,
    sortedChats,
    sortedMessages,
    createChat,
    joinChat,
    sendMessage,
    deleteMessage,
    isDeleting,
    backToChatList,
    formatTime,
    getInitials,
  };
}

const App = { template: "#template", setup };

createApp(App)
  .use(GraffitiPlugin, {
    graffiti: new GraffitiLocal(),
    // graffiti: new GraffitiDecentralized(),
  })
  .mount("#app");