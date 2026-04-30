import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import { GraffitiLocal } from "@graffiti-garden/implementation-local";
// import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import { GraffitiPlugin } from "@graffiti-garden/wrapper-vue";
import {
  Plus,
  ArrowLeft,
  Send,
  Trash2,
  MessageCircle,
  User,
  LogOut,
  Settings as SettingsIcon,
  Users,
} from "lucide-vue-next";
import { componentFromFolder } from "./components/component-loader.js";

const ChatList = componentFromFolder("./components/chat-list", import.meta.url);
const Chat = componentFromFolder("./components/chat", import.meta.url);
const Profile = componentFromFolder("./components/profile", import.meta.url);
const Settings = componentFromFolder("./components/settings", import.meta.url);

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/home" },
    { path: "/home", name: "home", component: ChatList },
    { path: "/chat/:chatId", name: "chat", component: Chat, props: true },
    { path: "/profile", name: "profile", component: Profile },
    { path: "/settings", name: "settings", component: Settings },
  ],
});

const App = { template: "#app-template" };

const app = createApp(App)
  .use(GraffitiPlugin, {
    graffiti: new GraffitiLocal(),
    // graffiti: new GraffitiDecentralized(),
  })
  .use(router);

// Register Lucide icons globally so any template can use them.
const icons = { Plus, ArrowLeft, Send, Trash2, MessageCircle, User, LogOut, SettingsIcon, Users };
for (const [name, component] of Object.entries(icons)) {
  app.component(name, component);
}

app.mount("#app");
