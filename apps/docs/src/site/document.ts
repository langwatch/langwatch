import { createHash } from "node:crypto";

import type { Operation } from "../features/api-reference/model/operation.ts";

/** Lazy browser entries by name; the bootstrap loads each through a `docs-island-<name>` meta. */
export const ISLANDS = {
  controls: "src/features/shell/browser/controls.ts",
  "context-menus": "src/features/shell/browser/context-menus.tsx",
  copy: "src/features/shell/browser/copy.ts",
  tabs: "src/features/content/browser/tabs.ts",
  menus: "src/features/navigation/browser/menus.ts",
  media: "src/features/content/browser/media.ts",
  toc: "src/features/shell/browser/toc.ts",
  disclosures: "src/features/content/browser/disclosures.ts",
  search: "src/features/search/browser/search.tsx",
  playground: "src/features/api-reference/browser/playground.tsx",
  reading: "src/browser/reading.ts",
} as const;

export type IslandName = keyof typeof ISLANDS;
export const ISLAND_NAMES = Object.keys(ISLANDS) as IslandName[];

/** The HTML files a page is published as: its directory index plus home and section aliases. */
export function pageTargets({ slug }: { slug: string }) {
  if (slug === "introduction") return ["index.html", "introduction/index.html"];
  if (slug.endsWith("/index")) return [`${slug}/index.html`, `${slug}.html`];
  return [`${slug}/index.html`];
}

/** Authored docs directories and files copied verbatim into the output and served by dev. */
export const STATIC_DIRS = ["images", "media", "logo"];
export const STATIC_FILES = ["favicon.svg"];

export function islandHead({
  sources,
  build = "dev",
}: {
  sources: Readonly<Record<string, string>>;
  build?: string;
}) {
  return `<meta name="docs-build" content="${build}">${ISLAND_NAMES.map((name) => `<meta name="docs-island-${name}" content="${sources[name]}">`).join("")}`;
}

export function pageData({ slug, operation }: { slug: string; operation: Operation | null }) {
  const json = JSON.stringify({ slug, operation }).replaceAll("<", "\\u003c");
  return `<script type="application/json" id="docs-page-data">${json}</script>`;
}

export const themeScript = `<script>try{var t=localStorage.getItem("theme");var d=t==="dark"||(!t||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.add(d?"dark":"light");document.documentElement.style.colorScheme=d?"dark":"light"}catch{}</script>`;

export const NOT_FOUND_HEAD = '<title>Not found</title><meta name="robots" content="noindex">';

/** Fills the index.html template's three slots and appends the inert page data. */
export function composeDocument({
  template,
  islands,
  head,
  app,
  slug,
  operation,
}: {
  template: string;
  islands: string;
  head: string;
  app: string;
  slug: string;
  operation: Operation | null;
}) {
  return template
    .replace("<!--islands-->", themeScript + islands)
    .replace("<!--head-->", head)
    .replace("<!--app-->", app)
    .replace("</body>", `${pageData({ slug, operation })}</body>`);
}

/** Moves server-emitted design-system `<style>` blocks out of the markup and drops scripts. */
export function extractStyles({ html }: { html: string }) {
  const styles: string[] = [];
  const body = html
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/g, (_, css: string) => {
      styles.push(css);
      return "";
    })
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  const css = [...new Set(styles)].join("\n");
  const hash = createHash("sha256").update(css).digest("hex").slice(0, 16);
  return { html: body, css, rules: [...new Set(styles)], href: `/assets/page-${hash}.css` };
}
