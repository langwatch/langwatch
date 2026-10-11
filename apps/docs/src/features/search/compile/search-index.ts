import type { Heading } from "../../content/compile/rehype-content.ts";
import { pageMarkdown } from "../../discovery/compile/markdown-export.ts";
import { trailOf, type Section } from "../../navigation/model/nav.ts";
import type { PublishedSearchEntry } from "../model/search-entry.ts";

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
