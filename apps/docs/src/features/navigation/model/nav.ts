import type { Release } from "../../releases/model/release.ts";
import type { Inline } from "./inline.ts";

export type NavItem =
  | { type: "page"; slug: string; title: string }
  | {
      type: "group";
      title: string;
      children: NavItem[];
      /** The group's own page, `slug` or `slug#heading`; its first page otherwise. */
      root?: string;
      /** Authored `expanded: true`: the group starts open on every page. */
      expanded?: boolean;
      /** An icon name or logo path, authored or taken from its first page with a logo. */
      icon?: string;
    };

export type PageMeta = {
  title: string;
  description: string;
  sidebarTitle: string;
  openapi: string;
  mode: string;
  icon: string;
  /** A brand logo path from an overview card linking here, e.g. /images/logos/mastra.svg. */
  logo: string;
  /** The page's last commit date (ISO 8601) when docs.json shows timestamps; "" when unknown. */
  updated: string;
  /** The authored `tag`, or "Deprecated" for a `deprecated: true` page; "" otherwise. */
  tag: string;
};

/** docs.json `contextual.options`, the page actions Mintlify knows, in its own spelling. */
export const CONTEXTUAL_OPTIONS = [
  "copy",
  "view",
  "claude",
  "chatgpt",
  "cursor",
  "vscode",
  "mcp",
] as const;
export type ContextualOption = (typeof CONTEXTUAL_OPTIONS)[number];
/** The known page actions among `options`, in their authored order; unknown names are dropped. */
export function contextualOptions({ options }: { options: readonly string[] }) {
  return options.flatMap((option) => CONTEXTUAL_OPTIONS.filter((known) => known === option));
}

export type Organization = { name: string; url: string; logo: string; sameAs: string[] };

/** docs.json `banner`: keyed by its content, so a changed announcement shows again. */
export type Announcement = { id: string; content: Inline[]; dismissible: boolean };

export type SiteMeta = {
  name: string;
  releases: Release[];
  searchPrompt: string;
  signIn: string;
  github: string;
  llms: string;
  stars: number | null;
  notFound: { title: string; description: string; content: Inline[] };
  /** docs.json `description`: the meta description of a page without its own. */
  description: string;
  organization: Organization | null;
  announcement: Announcement | null;
  contextual: ContextualOption[];
  /** A Google Tag Manager container id, or "" for none. */
  tagManager: string;
};

export type Section = { title: string; icon: string; children: NavItem[] };

/** The site map compiled from docs.json: rendered by the shell, searched and exported. */
export type Nav = {
  anchors: Section[];
  support: { title: string; icon: string; href: string }[];
  pages: Record<string, PageMeta>;
  site: SiteMeta;
};

export function flatPages({ items }: { items: NavItem[] }): { slug: string; title: string }[] {
  return items.flatMap((item) =>
    item.type === "page"
      ? [{ slug: item.slug, title: item.title }]
      : flatPages({ items: item.children }),
  );
}

export function firstSlug({ items }: { items: NavItem[] }): string {
  return flatPages({ items })[0]?.slug ?? "introduction";
}

export function ownsSlug({ items, slug }: { items: NavItem[]; slug: string }): boolean {
  return flatPages({ items }).some((page) => page.slug === slug);
}

type Group = Extract<NavItem, { type: "group" }>;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** Endpoint groups this small start open, so short API lists need no extra click. */
export const SMALL_ENDPOINT_GROUP = 4;

/** "GET" for an `openapi: GET /path` page; null for prose pages and bare-path references. */
export function methodOf({ meta }: { meta: PageMeta | undefined }): string | null {
  const first = meta?.openapi.split(/\s+/)[0]?.toUpperCase() ?? "";
  return METHODS.includes(first) ? first : null;
}

/** How many endpoint pages the group holds at any depth. */
export function endpointCount({
  group,
  pages,
}: {
  group: Group;
  pages: Record<string, PageMeta>;
}): number {
  return flatPages({ items: group.children }).filter((page) => methodOf({ meta: pages[page.slug] }))
    .length;
}

/** Where a group header links: its authored root, otherwise its first page. */
export function groupTarget({ group }: { group: Group }): string {
  return group.root ?? firstSlug({ items: group.children });
}

/** A group of one page with no other root shows as that page's link under the group's name. */
export function soleChild({ group }: { group: Group }): Extract<NavItem, { type: "page" }> | null {
  const [only, ...rest] = group.children;
  if (rest.length || only?.type !== "page") return null;
  return !group.root || group.root === only.slug ? only : null;
}

/** Authored-open groups, the current branch, single pages and small endpoint lists start open. */
export function startsOpen({
  group,
  slug,
  pages,
}: {
  group: Group;
  slug: string;
  pages: Record<string, PageMeta>;
}): boolean {
  if (group.expanded || ownsSlug({ items: group.children, slug })) return true;
  const size = flatPages({ items: group.children }).length;
  const endpoints = endpointCount({ group, pages });
  return size === 1 || (endpoints === size && endpoints <= SMALL_ENDPOINT_GROUP);
}

/** Group titles from the section root down to the page. */
export function trailOf({ items, slug }: { items: NavItem[]; slug: string }): string[] | null {
  for (const item of items) {
    if (item.type === "page" && item.slug === slug) return [];
    if (item.type === "group") {
      const inner = trailOf({ items: item.children, slug });
      if (inner) return [item.title, ...inner];
    }
  }
  return null;
}

export function neighbours({ section, slug }: { section: Section | undefined; slug: string }) {
  const pages = section ? flatPages({ items: section.children }) : [];
  const index = pages.findIndex((page) => page.slug === slug);
  return {
    previous: index > 0 ? pages[index - 1] : undefined,
    next: index >= 0 ? pages[index + 1] : undefined,
  };
}
