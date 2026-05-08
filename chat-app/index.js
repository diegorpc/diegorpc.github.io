import { createApp, computed } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
// import { GraffitiLocal } from "@graffiti-garden/implementation-local";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import { GraffitiPlugin, useGraffitiSession, useGraffitiDiscover } from "@graffiti-garden/wrapper-vue";
import {
  Plus,
  Send,
  Trash2,
  X,
  Bookmark,
  BookmarkCheck,
  Crown,
  MessageCircle,
  User,
  LogOut,
  Settings as SettingsIcon,
  Users,
  Files,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Reply,
  Eye,
  EyeOff,
} from "lucide-vue-next";
import { componentFromFolder } from "./components/component-loader.js";

const ChatList = componentFromFolder("./components/chat-list", import.meta.url);
const Chat = componentFromFolder("./components/chat", import.meta.url);
const Page = componentFromFolder("./components/page", import.meta.url);
const Profile = componentFromFolder("./components/profile", import.meta.url);
const Settings = componentFromFolder("./components/settings", import.meta.url);

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/home" },
    { path: "/home", name: "home", component: ChatList },
    { path: "/chat/:chatId", name: "chat", component: Chat, props: true },
    {
      path: "/chat/:chatId/page/:pageId",
      name: "page",
      component: Page,
      props: true,
    },
    { path: "/profile", name: "profile", component: Profile },
    { path: "/settings", name: "settings", component: Settings },
  ],
});

const SETTINGS_SCHEMA = {
  properties: {
    value: {
      required: ["activity", "type"],
      properties: {
        activity: { const: "Update" },
        type: { const: "Settings" },
      },
    },
  },
};

const App = {
  template: "#app-template",
  setup() {
    const session = useGraffitiSession();
    const { objects: settingsObjects } = useGraffitiDiscover(
      computed(() => session.value?.actor ? [`${session.value.actor}/settings`] : []),
      SETTINGS_SCHEMA,
    );
    const reduceMotion = computed(() => {
      const latest = settingsObjects.value
        .filter((o) => o.actor === session.value?.actor)
        .toSorted((a, b) => b.value.published - a.value.published)[0];
      return latest?.value.reduceMotion ?? false;
    });
    return { reduceMotion };
  },
};

const app = createApp(App)
  .use(GraffitiPlugin, {
    // graffiti: new GraffitiLocal(),
    graffiti: new GraffitiDecentralized(),
  })
  .use(router);

// Register Lucide icons globally so any template can use them.
const icons = { Plus, Send, Trash2, X, Crown, MessageCircle, User, LogOut, SettingsIcon, Users, Files, Bookmark, BookmarkCheck, ChevronUp, ChevronLeft, ChevronRight, Reply, Eye, EyeOff };
for (const [name, component] of Object.entries(icons)) {
  app.component(name, component);
}

app.mount("#app");
