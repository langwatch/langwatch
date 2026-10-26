import { EXAMPLE_LANGUAGES } from "../../api-reference/model.ts";

/**
 * How the site treats one authored key. `pinned` means the site implements exactly this value,
 * so changing it in docs.json fails the inventory test instead of silently diverging; `gap`
 * names a key still to port and the code that owns it.
 */
export type KeyHandling =
  | { status: "honoured"; by: string }
  | { status: "pinned"; value: unknown; by: string }
  | { status: "different"; reason: string }
  | { status: "gap"; owner: string; reason: string };

const honoured = (by: string): KeyHandling => ({ status: "honoured", by });
const pinned = (value: unknown, by: string): KeyHandling => ({ status: "pinned", value, by });
const different = (reason: string): KeyHandling => ({ status: "different", reason });

const NAV_TREE = honoured("navigation/compile/nav.ts buildNav, rendered by navigation/ui");

/** Every key docs.json authors; navigation items at any depth are `navigation.anchors[].*`. */
export const DOCS_JSON_KEYS: Record<string, KeyHandling> = {
  $schema: different("Editor validation for Mintlify's own schema; nothing renders it."),
  theme: different("The site uses the langwatch.ai brand theme, not a Mintlify theme."),
  name: honoured("site.name: llms.txt, llms-full.txt and the directory title"),
  colors: different("The site uses the langwatch.ai brand palette (app/theme-config.ts)."),
  "colors.primary": different("The langwatch.ai brand palette replaces Mintlify colours."),
  "colors.light": different("The langwatch.ai brand palette replaces Mintlify colours."),
  "colors.dark": different("The langwatch.ai brand palette replaces Mintlify colours."),
  appearance: honoured("site/document.ts themeScript and shell/ui/theme-menu.tsx"),
  "appearance.default": pinned("system", "themeScript follows the system until a reader picks"),
  "appearance.strict": pinned(false, "shell/ui/theme-menu.tsx offers light, dark and system"),
  logo: honoured("shell/ui/header.tsx renders the design-system logo for both themes"),
  "logo.light": pinned("/logo/dark.svg", "the design-system FullLogo is this artwork"),
  "logo.dark": pinned("/logo/light.svg", "the design-system FullLogo is this artwork"),
  favicon: pinned(
    "/favicon.svg",
    "index.html links it; site/hashed-assets.ts publishes it under this name",
  ),
  description: honoured("site.description: page-head.ts meta description fallback"),
  seo: honoured("discovery/compile/page-head.ts"),
  "seo.indexing": pinned("navigable", "only pages listed in navigation are published or mapped"),
  "seo.organization": honoured("page-head.ts Organization JSON-LD, publisher of the WebSite"),
  "seo.organization.name": honoured("page-head.ts Organization JSON-LD"),
  "seo.organization.url": honoured("page-head.ts Organization JSON-LD"),
  "seo.organization.logo": honoured("page-head.ts Organization JSON-LD"),
  "seo.organization.sameAs": honoured("page-head.ts Organization JSON-LD"),
  metadata: honoured("page meta `updated`"),
  "metadata.timestamp": honoured("shell/ui/page-footer.tsx Last updated, JSON-LD dateModified"),
  search: honoured("shell/ui/header.tsx search button"),
  "search.prompt": honoured("site.searchPrompt"),
  errors: honoured("app/app.tsx NotFound"),
  "errors.404": honoured("app/app.tsx NotFound"),
  "errors.404.redirect": pinned(false, "unknown pages answer 404.html, never the home page"),
  "errors.404.title": honoured("site.notFound.title"),
  "errors.404.description": honoured("site.notFound.content, links included"),
  markdown: honoured("discovery/compile/markdown-export.ts"),
  "markdown.instructions": honoured("markdown-export.ts Agent Instructions block"),
  banner: honoured("releases/ui/banner.tsx SiteAnnouncement"),
  "banner.content": honoured("site.announcement.content, inline Markdown"),
  "banner.dismissible": honoured("site.announcement.dismissible, shell/browser/controls.ts"),
  contextual: honoured("shell/ui/page-menu.tsx"),
  "contextual.options": honoured("site.contextual: page actions in authored order"),
  api: honoured("api-reference"),
  "api.playground": honoured("api-reference/ui/playground.tsx"),
  "api.playground.display": pinned("interactive", "every endpoint page has a live playground"),
  "api.examples": honoured("api-reference/model/codegen.ts"),
  "api.examples.languages": pinned(
    EXAMPLE_LANGUAGES.map((language) => language.id),
    "api-reference/model/operation.ts EXAMPLE_LANGUAGES",
  ),
  "api.examples.defaults": {
    status: "gap",
    owner: "api-reference/model/codegen.ts",
    reason: "Mintlify's `required` shows required fields only; the examples fill every field.",
  },
  navbar: honoured("shell/ui/header.tsx"),
  "navbar.links": honoured("site.signIn and site.llms by label"),
  "navbar.links[].label": different(
    "Labels follow the site's copy (Open app, Docs for agents); links are found by label.",
  ),
  "navbar.links[].href": honoured("header Open app, mobile navigation, footer agent link"),
  "navbar.primary": honoured("shell/ui/github-link.tsx"),
  "navbar.primary.type": pinned("github", "shell/ui/github-link.tsx with the star count"),
  "navbar.primary.href": honoured("site.github"),
  integrations: honoured("shell/browser/tag-manager.ts"),
  "integrations.gtm": honoured("site.tagManager"),
  "integrations.gtm.tagId": honoured("page-head.ts docs-gtm meta, loaded by tag-manager.ts"),
  navigation: NAV_TREE,
  "navigation.anchors": NAV_TREE,
  "navigation.anchors[].anchor": NAV_TREE,
  "navigation.anchors[].icon": NAV_TREE,
  "navigation.anchors[].groups": NAV_TREE,
  "navigation.anchors[].*.group": NAV_TREE,
  "navigation.anchors[].*.pages": NAV_TREE,
  "navigation.anchors[].*.root": NAV_TREE,
  "navigation.anchors[].*.expanded": NAV_TREE,
  "navigation.anchors[].*.icon": NAV_TREE,
  "navigation.global": NAV_TREE,
  "navigation.global.anchors": NAV_TREE,
  "navigation.global.anchors[].anchor": NAV_TREE,
  "navigation.global.anchors[].href": NAV_TREE,
  "navigation.global.anchors[].icon": NAV_TREE,
  redirects: honoured("navigation/compile/redirects.ts"),
  "redirects[].source": honoured("navigation/compile/redirects.ts"),
  "redirects[].destination": honoured("navigation/compile/redirects.ts"),
};

/** Every frontmatter key a page authors. */
export const FRONTMATTER_KEYS: Record<string, KeyHandling> = {
  title: honoured("page title, head and exports"),
  sidebarTitle: honoured("navigation label"),
  description: honoured("page lede, meta description and exports"),
  openapi: honoured("api-reference endpoint pages"),
  icon: honoured("navigation/ui/nav-tree.tsx"),
  mode: honoured("`wide` widens the shell (app/app.tsx)"),
  tag: honoured("page meta `tag`, shown in the page header"),
  deprecated: honoured("page meta `tag` Deprecated, shown in the page header"),
  keywords: {
    status: "gap",
    owner: "search/compile/search-index.ts",
    reason: "Mintlify searches keywords; the search index does not read them yet.",
  },
};

/* Navigation nests groups in `groups` and `pages` at any depth; those collapse to `*`. */
const NESTED_ITEMS = /(\.(groups|pages)\[\])+/g;

/** Every key path in a parsed docs.json, arrays as `[]`, nested navigation items as `*`. */
export function configKeyPaths({ config }: { config: unknown }): string[] {
  const paths = new Set<string>();
  const walk = ({ value, at }: { value: unknown; at: string }) => {
    if (Array.isArray(value)) {
      for (const item of value) walk({ value: item, at: `${at}[]` });
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const next = at ? `${at}.${key}` : key;
      paths.add(next.replace(NESTED_ITEMS, ".*"));
      walk({ value: child, at: next });
    }
  };
  walk({ value: config, at: "" });
  return [...paths];
}

/** The value at a dotted key path without arrays, e.g. `api.playground.display`. */
export function valueAt({ config, path }: { config: unknown; path: string }): unknown {
  let value = config;
  for (const key of path.split(".")) {
    value = value && typeof value === "object" ? Reflect.get(value, key) : void 0;
  }
  return value;
}
