import { z } from "zod/mini";

import type { Heading } from "../../content/compile/rehype-content.ts";
import { pageMarkdown } from "../../discovery/compile/markdown-export.ts";
import { trailOf, type Section } from "../../navigation/model/nav.ts";
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
  anchors: Pick<Section, "title" | "children">[];
  pages: Record<string, { title: string; description: string; openapi?: string }>;
};

export function searchTrail({ nav, slug }: { nav: SearchNav; slug: string }) {
  for (const anchor of nav.anchors) {
    const trail = trailOf({ items: anchor.children, slug });
    if (trail) return { section: anchor.title, trail: [anchor.title, ...trail].join(" › ") };
  }
  return { section: "", trail: "" };
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
  return openapi ? { method: openapi.split(/\s+/)[0].toUpperCase() } : {};
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
  return {
    slug,
    ...methodOf({ openapi: meta.openapi }),
    title: meta.title,
    description: meta.description,
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
    .map((page, at) => (page - pages[at]).toString(36))
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
    terms[pages[0]].push([word, gapsOf({ pages })]);
  return JSON.stringify(
    parsed.map((entry, position): PublishedIndexEntry => {
      const sorted = terms[position].toSorted(([left], [right]) => (left < right ? -1 : 1));
      const gaps = sorted.map(([, gap]) => gap);
      return {
        slug: entry.slug,
        ...(entry.method ? { method: entry.method } : {}),
        title: entry.title,
        description: entry.description,
        ...(entry.section === impliedSection({ trail: entry.trail })
          ? {}
          : { section: entry.section }),
        ...(entry.trail ? { trail: entry.trail } : {}),
        ...(entry.headings.length ? { headings: entry.headings.map(publishedHeading) } : {}),
        ...(sorted.length ? { terms: sorted.map(([word]) => word).join(" ") } : {}),
        ...(gaps.some(Boolean) ? { pages: gaps.join(" ") } : {}),
      };
    }),
  );
}
