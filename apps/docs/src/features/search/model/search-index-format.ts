/* The shape of search-index.json, shared by the build that writes it and the browser that reads
   it. No schema library: the browser decodes it by hand so the search island stays small. */

/** A heading: its text when its anchor is the one the text implies, else `[anchor, text]`. */
export type PublishedHeading = string | [id: string, text: string];

/**
 * One page, in navigation order. `terms`: the sorted article words this page uses first; `pages`
 * lines up with it, each word's later pages as base-36 gaps (`3,1` is 3 and 4 positions later,
 * empty when none). Empty fields are left out.
 */
export type PublishedIndexEntry = {
  slug: string;
  method?: string;
  title: string;
  description: string;
  section?: string;
  trail?: string;
  headings?: PublishedHeading[];
  terms?: string;
  pages?: string;
};

export const TRAIL_SEPARATOR = " › ";

const EDGES = /^[^\p{L}\p{M}\p{N}_]+|[^\p{L}\p{M}\p{N}_]+$/gu;

/** A term without its surrounding punctuation: `"level":` is `level`, `/a/b/` is `a/b`. */
export function trimTerm({ term }: { term: string }) {
  return term.replace(EDGES, "");
}

/**
 * The words of an article as search matches them: lowercase, split at whitespace, trimmed of
 * surrounding punctuation. A term without spaces is in the article exactly when it is part of
 * one of these words, so API paths and dotted names keep their order.
 */
export function articleWords({ text }: { text: string }) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((term) => trimTerm({ term }))
    .filter(Boolean);
}

/** The anchor a heading's text implies before duplicates are numbered. */
export function impliedAnchor({ text }: { text: string }) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** The section a trail implies: its first segment. */
export function impliedSection({ trail }: { trail: string }) {
  return trail.split(TRAIL_SEPARATOR)[0] ?? "";
}

/**
 * The text a page is searched by before its article, as search compares it. An article word
 * inside this text is left out of the index: search finds the page by its own text instead.
 */
export function ownText({
  slug,
  title,
  description,
  headings,
}: {
  slug: string;
  title: string;
  description: string;
  headings: string[];
}) {
  return [title, description, ...headings].map((text) => text.toLowerCase()).concat(slug);
}
