import { createApp, computed, ref, onUnmounted } from "vue";
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
    // Reactive desktop breakpoint flag. Used to render a persistent
    // chat-list sidebar alongside the router-view on wide viewports.
    const desktopMq = window.matchMedia("(min-width: 900px)");
    const isDesktop = ref(desktopMq.matches);
    const onMqChange = (e) => { isDesktop.value = e.matches; };
    if (desktopMq.addEventListener) {
      desktopMq.addEventListener("change", onMqChange);
      onUnmounted(() => desktopMq.removeEventListener("change", onMqChange));
    } else if (desktopMq.addListener) {
      // Safari < 14 fallback
      desktopMq.addListener(onMqChange);
      onUnmounted(() => desktopMq.removeListener(onMqChange));
    }

    return { reduceMotion, isDesktop };
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

// Register ChatList globally so it can be reused as a persistent
// sidebar in the App template on desktop viewports (in addition to
// being a route component for `/home`).
app.component("chat-list", ChatList);

app.mount("#app");
