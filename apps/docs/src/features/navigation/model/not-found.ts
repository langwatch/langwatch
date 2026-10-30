import { flatPages, type PageMeta, type Section } from "./nav.ts";

/** The 404 page's inert page list: section titles once, then `[slug, title, section index]`. */
export type NotFoundIndex = { sections: string[]; pages: [string, string, number][] };

export type Suggestion = { slug: string; title: string; section: string };

/** Every page once, in navigation order, under the first section whose tree holds it. */
export function notFoundIndex({
  sections,
  pages: meta = {},
}: {
  sections: Section[];
  pages?: Record<string, PageMeta>;
}): NotFoundIndex {
  const seen = new Set<string>();
  const pages: [string, string, number][] = [];
  sections.forEach((section, index) => {
    for (const page of flatPages({ items: section.children })) {
      if (seen.has(page.slug)) continue;
      seen.add(page.slug);
      pages.push([page.slug, meta[page.slug]?.title || page.title, index]);
    }
  });
  return { sections: sections.map((section) => section.title), pages };
}

/** A section title as an attribute value: "API Reference" -> "api-reference". */
export function sectionId({ title }: { title: string }) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function segmentsOf({ path }: { path: string }) {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* A malformed address still gets matched on its raw text. */
  }
  return decoded
    .slice(0, 300)
    .toLowerCase()
    .replace(/\.(?:html?|mdx?)$/, "")
    .split("/")
    .filter(Boolean);
}

const IGNORED = new Set(
  "docs index html 404 the and for with page pages missing old new".split(" "),
);

function tokens({ text }: { text: string }) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !IGNORED.has(token));
}

/** One cell of the edit table: insert, delete, replace, or swap a neighbouring pair. */
function editCell({ a, b, i, j, at }: EditCell) {
  const replace = at(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1);
  const swapped = a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];
  const swap = swapped ? at(i - 2, j - 2) + 1 : Infinity;
  return Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, replace, swap);
}

type EditCell = {
  a: string;
  b: string;
  i: number;
  j: number;
  at: (i: number, j: number) => number;
};

/** Edits between two words, a swapped neighbouring pair counting as one (`pyhton`, `python`). */
function editDistance({ a, b }: { a: string; b: string }) {
  const table = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => Math.max(i, j) * Number(i === 0 || j === 0)),
  );
  const at = (i: number, j: number) => table[i]?.[j] ?? Infinity;
  table.forEach((row, i) => {
    for (let j = 1; i > 0 && j <= b.length; j++) row[j] = editCell({ a, b, i, j, at });
  });
  return at(a.length, b.length);
}

/** How well one requested word matches one page word: exact, a prefix, then a typo. */
function wordScore({ token, word }: { token: string; word: string }) {
  if (word === token) return 6;
  if (token.length < 4 || word.length < 4) return 0;
  if (word.startsWith(token) || token.startsWith(word)) return 3;
  if (Math.abs(word.length - token.length) > 2) return 0;
  const allowed = token.length >= 7 ? 2 : 1;
  return editDistance({ a: word, b: token }) <= allowed ? 2 : 0;
}

/** Leading path segments a page shares with the request: `a/b/x` and `a/b/c` share two. */
function sharedPrefix({ requested, slug }: { requested: string[]; slug: string }) {
  const parts = slug.split("/");
  let shared = 0;
  while (shared < requested.length && parts[shared] === requested[shared]) shared++;
  return shared;
}

/**
 * The section a missing address sits in: the one owning most pages that share its longest
 * leading path, so `/api-reference/old` is API Reference even though nothing matches `old`.
 */
export function sectionOfPath({ path, index }: { path: string; index: NotFoundIndex }) {
  const requested = segmentsOf({ path });
  const shared = index.pages.map(([slug]) => sharedPrefix({ requested, slug }));
  const longest = Math.max(0, ...shared);
  if (!longest) return null;
  const counts = new Map<number, number>();
  index.pages.forEach(([, , section], position) => {
    if (shared[position] === longest) counts.set(section, (counts.get(section) ?? 0) + 1);
  });
  const [section] = [...counts].toSorted((a, b) => b[1] - a[1] || a[0] - b[0])[0] ?? [];
  return section === undefined ? null : (index.sections[section] ?? null);
}

/**
 * The pages closest to a missing address, best first and navigation order on ties: each
 * requested word scores its best page word, and a shared leading path adds weight.
 */
export function suggestPages({
  path,
  index,
  limit = 5,
}: {
  path: string;
  index: NotFoundIndex;
  limit?: number;
}): Suggestion[] {
  const requested = segmentsOf({ path });
  const query = tokens({ text: requested.join(" ") });
  if (!query.length) return [];
  return index.pages
    .map(([slug, title, section], position) => {
      const words = tokens({ text: `${slug} ${title}` });
      const score =
        query.reduce(
          (total, token) => total + Math.max(0, ...words.map((word) => wordScore({ token, word }))),
          0,
        ) +
        2 * sharedPrefix({ requested, slug });
      return { slug, title, section: index.sections[section] ?? "", score, position };
    })
    .filter((page) => page.score > 0)
    .toSorted((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, limit)
    .map(({ slug, title, section }) => ({ slug, title, section }));
}

/** The three ways the 404 page acts out a miss: a terminal, a trace, or the castle. */
export type NotFoundScene = "engineering" | "product" | "other";

/* Sections, by their docs.json titles. Platform mixes product guides with engineering and site
   pages, so its folders decide; a folder listed here wins over its section. */
const SECTION_SCENES: Readonly<Record<string, NotFoundScene>> = {
  "API Reference": "engineering",
  Observability: "engineering",
  "AI Gateway": "engineering",
  "Coding Agents": "engineering",
  "Self Hosting": "engineering",
  "AI Governance": "product",
  Langy: "product",
  Platform: "product",
};
const FOLDER_SCENES: Readonly<Record<string, NotFoundScene>> = {
  integration: "engineering",
  integrations: "engineering",
  skills: "engineering",
  changelog: "engineering",
  "dspy-visualization": "engineering",
  observability: "product",
  introduction: "other",
  pricing: "other",
  support: "other",
  status: "other",
};

/** The scene for a page: its top folder when listed, else its section, else the castle. */
export function sceneOf({ folder, section }: { folder: string; section: string | null }) {
  return FOLDER_SCENES[folder] ?? (section ? SECTION_SCENES[section] : void 0) ?? "other";
}

/** The words of a missing address, for the search bar: `/api/traces/serch` -> `traces serch`. */
export function searchWords({ path }: { path: string }) {
  return tokens({ text: segmentsOf({ path }).join(" ") }).join(" ");
}

/**
 * What the 404 page shows: the section and folder by path, or else the best match's; the scene
 * they imply; and the closest pages.
 */
export function notFoundContext({ path, index }: { path: string; index: NotFoundIndex }) {
  const pages = suggestPages({ path, index, limit: 3 });
  const [first = ""] = segmentsOf({ path });
  const known = index.pages.some(([slug]) => slug.split("/")[0] === first);
  const folder = known ? first : (pages[0]?.slug.split("/")[0] ?? "");
  const section = sectionOfPath({ path, index }) ?? pages[0]?.section ?? null;
  return { section, pages, scene: folder || section ? sceneOf({ folder, section }) : "other" };
}
