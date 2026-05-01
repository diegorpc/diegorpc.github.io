import { defineAsyncComponent } from "vue";

// Loading placeholder shown while an async component is being fetched.
// Uses flex: 1 so it fills the router-view space and keeps the footer nav pinned.
const AsyncLoadingComponent = {
  template: `
    <div class="async-loading">
      <div class="loading-spinner"></div>
    </div>
  `,
};

// Turns a folder (with index.html template + index.js definition)
// into an async Vue component. The folder path is resolved relative
// to the importing module via import.meta.url.
export function componentFromFolder(folder, baseUrl) {
  const base = new URL(folder, baseUrl);
  // Ensure trailing slash so URL resolution treats it as a directory.
  const dirUrl = base.href.endsWith("/") ? base.href : `${base.href}/`;
  return defineAsyncComponent({
    loader: async () => {
      const [html, mod] = await Promise.all([
        fetch(new URL("index.html", dirUrl)).then((r) => r.text()),
        import(new URL("index.js", dirUrl).href),
      ]);
      return { ...mod.default, template: html };
    },
    loadingComponent: AsyncLoadingComponent,
    delay: 0,
  });
}
