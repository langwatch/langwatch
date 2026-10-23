import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod/mini";

import { ICONS, LOGO_ASSETS } from "../../../lib/icon-registry.ts";
import type { Heading } from "../../content/compile/rehype-content.ts";
import { pageMarkdown } from "../../discovery/compile/markdown-export.ts";
import { trailOf, type NavItem, type Section } from "../../navigation/model/nav.ts";
import {
  searchEntrySchema,
  type PublishedSearchEntry,
  type SearchEntry,
} from "../model/search-entry.ts";
import {
  impliedAnchor,
  impliedSection,
  ownText,
  articleWords,
  type PublishedHeading,
  type PublishedIndexEntry,
} from "../model/search-index-format.ts";

/** The slice of the navigation an index entry reads. */
type SearchNav = {
  anchors: (Pick<Section, "title" | "children"> & { icon?: string })[];
  pages: Record<
    string,
    { title: string; description: string; openapi?: string; icon?: string; logo?: string }
  >;
};

export function searchTrail({ nav, slug }: { nav: SearchNav; slug: string }) {
  for (const anchor of nav.anchors) {
    const trail = trailOf({ items: anchor.children, slug });
    if (trail) return { section: anchor.title, trail: [anchor.title, ...trail].join(" › ") };
  }
  return { section: "", trail: "" };
}

/** The icons of the groups holding the page, outermost first; null when they do not hold it. */
function groupIcons({ items, slug }: { items: NavItem[]; slug: string }): string[] | null {
  for (const item of items) {
    if (item.type === "page" && item.slug === slug) return [];
    if (item.type === "group") {
      const inner = groupIcons({ items: item.children, slug });
      if (inner) return [item.icon ?? "", ...inner];
    }
  }
  return null;
}

/** The page's own icon, else its innermost group's with one, else its section's. */
export function pageIcon({ nav, slug }: { nav: SearchNav; slug: string }) {
  const meta = nav.pages[slug];
  let icon = meta?.icon || meta?.logo || "";
  for (const anchor of icon ? [] : nav.anchors) {
    const groups = groupIcons({ items: anchor.children, slug });
    if (!groups) continue;
    icon = groups.findLast(Boolean) || anchor.icon || "";
    break;
  }
  return LOGO_ASSETS[icon] ?? icon;
}

export function bodyText({ html }: { html: string }) {
  const article =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/)?.[1] ??
    html.match(/<main\b[^>]*\bid="content"[^>]*>([\s\S]*?)<\/main>/)?.[1] ??
    "";
  return article
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function methodOf({ openapi }: { openapi?: string }) {
  return openapi ? { method: (openapi.split(/\s+/)[0] ?? "").toUpperCase() } : {};
}

function iconOf({ nav, slug }: { nav: SearchNav; slug: string }) {
  const icon = pageIcon({ nav, slug });
  return icon ? { icon } : {};
}

/** One page's entry from its rendered HTML: article text plus heading anchors. */
export function searchEntry({
  nav,
  slug,
  html,
  headings,
}: {
  nav: SearchNav;
  slug: string;
  html: string;
  headings: Heading[];
}): PublishedSearchEntry {
  const meta = nav.pages[slug];
  if (!meta) throw new Error(`No navigation entry for ${slug}`);
  return {
    slug,
    ...methodOf({ openapi: meta.openapi }),
    title: meta.title,
    description: meta.description,
    ...iconOf({ nav, slug }),
    ...searchTrail({ nav, slug }),
    body: bodyText({ html }),
    headings: headings.map(({ id, text }) => ({ id, text })),
  };
}

/** The dev server's index, from Markdown sources instead of rendered pages: no heading anchors. */
export function sourceSearchIndex({ docsRoot, nav }: { docsRoot: string; nav: SearchNav }) {
  return Object.entries(nav.pages).map(([slug, meta]) => ({
    slug,
    ...methodOf({ openapi: meta.openapi }),
    title: meta.title,
    description: meta.description,
    ...iconOf({ nav, slug }),
    ...searchTrail({ nav, slug }),
    body: bodyText({
      html: `<article>${pageMarkdown({ docsRoot, slug })}</article>`,
    }),
    headings: [],
  }));
}

function publishedHeading({ id, text }: { id: string; text: string }): PublishedHeading {
  return impliedAnchor({ text }) === id ? text : [id, text];
}

/** Each distinct article word outside its page's own text, with the positions of its pages. */
function wordPages({ entries }: { entries: SearchEntry[] }) {
  const pages = new Map<string, number[]>();
  entries.forEach((entry, position) => {
    const own = ownText({ ...entry, headings: entry.headings.map((heading) => heading.text) });
    for (const word of new Set(articleWords({ text: entry.body }))) {
      if (own.some((text) => text.includes(word))) continue;
      const list = pages.get(word);
      if (list) list.push(position);
      else pages.set(word, [position]);
    }
  });
  return pages;
}

/** The base-36 distances from each page using a word to the next, after its first. */
function gapsOf({ pages }: { pages: number[] }) {
  return pages
    .slice(1)
    .map((page, at) => (page - (pages[at] ?? 0)).toString(36))
    .join(",");
}

/**
 * search-index.json from the rendered entries, in navigation order: each article word is written
 * once, on the first page using it, with the later pages using it (see PublishedIndexEntry).
 */
export function publishSearchIndex({ entries }: { entries: unknown[] }) {
  const parsed = z.array(searchEntrySchema).parse(entries);
  const terms: [word: string, gaps: string][][] = parsed.map(() => []);
  for (const [word, pages] of wordPages({ entries: parsed }))
    terms[pages[0] ?? 0]?.push([word, gapsOf({ pages })]);
  const drawn = new Set<string>();
  return JSON.stringify(
    parsed.map((entry, position) => {
      const published = publishedEntry({ entry, terms: terms[position] ?? [] });
      if (drawn.has(entry.icon)) return published;
      drawn.add(entry.icon);
      const glyph = glyphOf({ icon: entry.icon });
      return glyph ? { ...published, glyph } : published;
    }),
  );
}

/** The SVG body of a bundled icon, for the browser to draw without bundling the icon set. */
function glyphOf({ icon }: { icon: string }) {
  const Glyph = ICONS[icon];
  if (!Glyph) return "";
  return renderToStaticMarkup(createElement(Glyph))
    .replace(/^<svg[^>]*>|<\/svg>$/g, "")
    .replace(/><\/\w+>/g, "/>");
}

function publishedEntry({
  entry,
  terms,
}: {
  entry: z.infer<typeof searchEntrySchema>;
  terms: [word: string, gaps: string][];
}): PublishedIndexEntry {
  const sorted = terms.toSorted(([left], [right]) => (left < right ? -1 : 1));
  const gaps = sorted.map(([, gap]) => gap);
  const section =
    entry.section === impliedSection({ trail: entry.trail }) ? undefined : entry.section;
  return {
    slug: entry.slug,
    ...(entry.method ? { method: entry.method } : {}),
    title: entry.title,
    description: entry.description,
    ...(section === undefined ? {} : { section }),
    ...(entry.trail ? { trail: entry.trail } : {}),
    ...(entry.icon ? { icon: entry.icon } : {}),
    ...(entry.headings.length ? { headings: entry.headings.map(publishedHeading) } : {}),
    ...(sorted.length ? { terms: sorted.map(([word]) => word).join(" ") } : {}),
    ...(gaps.some(Boolean) ? { pages: gaps.join(" ") } : {}),
  };
}
