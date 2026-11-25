import { impliedAnchor, impliedSection, ownText, trimTerm } from "./search-index-format.ts";

type Heading = { id: string; text: string };

/** A page with its text lowercased once at load, so a keystroke never lowercases the corpus. */
export type IndexedEntry = {
  slug: string;
  method: string;
  title: string;
  section: string;
  description: string;
  trail: string;
  icon: string;
  headings: Heading[];
  match: {
    title: string;
    description: string;
    headings: string[];
    words: string[];
    own: string[];
  };
};

/** The decoded index: pages plus every article word with the positions of the pages using it. */
export type SearchIndex = {
  entries: IndexedEntry[];
  vocabulary: string[];
  postings: number[][];
  /** Each named icon's SVG body, as published on the first page naming it. */
  glyphs: Map<string, string>;
  /** Pages whose article has a word containing a term, filled as terms are first searched. */
  pagesWith: Map<string, Set<number>>;
};

type Result = { entry: IndexedEntry; heading?: Heading; score: number };

const MAX_RESULTS = 20;
const STOP_WORDS = new Set(["how", "do", "i", "a", "the", "to", "is"]);

class MalformedIndexError extends Error {
  constructor() {
    super("Search index is malformed");
  }
}

function text({ value, optional = false }: { value: unknown; optional?: boolean }) {
  if (optional && value === undefined) return "";
  if (typeof value !== "string") throw new MalformedIndexError();
  return value;
}

function headingOf({ value }: { value: unknown }): Heading {
  if (typeof value === "string") return { id: impliedAnchor({ text: value }), text: value };
  if (!Array.isArray(value) || value.length !== 2) throw new MalformedIndexError();
  return { id: text({ value: value[0] }), text: text({ value: value[1] }) };
}

function indexedEntry({ value }: { value: unknown }): IndexedEntry {
  if (!value || typeof value !== "object") throw new MalformedIndexError();
  const record = value as Record<string, unknown>;
  const headings = record.headings ?? [];
  if (!Array.isArray(headings)) throw new MalformedIndexError();
  const trail = text({ value: record.trail, optional: true });
  const entry = {
    slug: text({ value: record.slug }),
    method: text({ value: record.method, optional: true }),
    title: text({ value: record.title }),
    description: text({ value: record.description }),
    section:
      record.section === undefined ? impliedSection({ trail }) : text({ value: record.section }),
    trail,
    icon: text({ value: record.icon, optional: true }),
    headings: headings.map((heading) => headingOf({ value: heading })),
  };
  const title = entry.title.toLowerCase();
  const description = entry.description.toLowerCase();
  const words = `${title} ${description} ${trail.toLowerCase()}`.split(/[^a-z0-9_]+/);
  return {
    ...entry,
    match: {
      title,
      description,
      headings: entry.headings.map((heading) => heading.text.toLowerCase()),
      words: [...new Set(words)].filter((word) => word.length >= 4),
      own: ownText({ ...entry, headings: entry.headings.map((heading) => heading.text) }),
    },
  };
}

/** Reads the words this page is first to use and the later pages using each (see the format). */
function readTerms({
  value,
  position,
  count,
  index,
}: {
  value: { terms?: unknown; pages?: unknown };
  position: number;
  count: number;
  index: SearchIndex;
}) {
  const terms = text({ value: value.terms, optional: true });
  if (!terms) return;
  const words = terms.split(" ");
  const gaps = text({ value: value.pages, optional: true }).split(" ");
  if (value.pages !== undefined && gaps.length !== words.length) throw new MalformedIndexError();
  words.forEach((word, at) => {
    const pages = [position];
    const run = gaps[at];
    for (const gap of run ? run.split(",") : []) {
      const next = (pages.at(-1) ?? position) + Number.parseInt(gap, 36);
      if (!(next > position && next < count)) throw new MalformedIndexError();
      pages.push(next);
    }
    index.vocabulary.push(word);
    index.postings.push(pages);
  });
}

/** The published search-index.json, checked and decoded; anything malformed throws. */
export function decodeSearchIndex({ data }: { data: unknown }): SearchIndex {
  if (!Array.isArray(data)) throw new MalformedIndexError();
  const index: SearchIndex = {
    entries: [],
    vocabulary: [],
    postings: [],
    glyphs: new Map(),
    pagesWith: new Map(),
  };
  data.forEach((value: unknown, position) => {
    const entry = indexedEntry({ value });
    index.entries.push(entry);
    const glyph = text({ value: (value as { glyph?: unknown }).glyph, optional: true });
    if (glyph) index.glyphs.set(entry.icon, glyph);
    readTerms({ value: value as { terms?: unknown }, position, count: data.length, index });
  });
  return index;
}

function pagesWith({ index, token }: { index: SearchIndex; token: string }) {
  let pages = index.pagesWith.get(token);
  if (pages) return pages;
  pages = new Set();
  for (const [position, word] of index.vocabulary.entries())
    if (word.includes(token)) for (const page of index.postings[position] ?? []) pages.add(page);
  index.pagesWith.set(token, pages);
  return pages;
}

/** Whether the term, trimmed of surrounding punctuation, is part of a word in the article or of
    the page's own text (article words found there are not indexed). */
function articleHas({
  index,
  position,
  term,
}: {
  index: SearchIndex;
  position: number;
  term: string;
}) {
  const token = trimTerm({ term });
  if (!token) return false;
  return (
    (index.entries[position]?.match.own.some((text) => text.includes(token)) ?? false) ||
    pagesWith({ index, token }).has(position)
  );
}

function similarWord({ word, term }: { word: string; term: string }) {
  if (term.length < 5 || Math.abs(word.length - term.length) > 1) return false;
  let left = 0;
  while (left < term.length && word[left] === term[left]) left += 1;
  if (word.length === term.length) {
    const replacement = word.slice(left + 1) === term.slice(left + 1);
    const transpose =
      word[left] === term[left + 1] &&
      word[left + 1] === term[left] &&
      word.slice(left + 2) === term.slice(left + 2);
    return replacement || transpose;
  }
  if (word.length > term.length) return word.slice(left + 1) === term.slice(left);
  return word.slice(left) === term.slice(left + 1);
}

function scoreTerm({
  index,
  position,
  term,
}: {
  index: SearchIndex;
  position: number;
  term: string;
}): { score: number; heading?: Heading } {
  const entry = index.entries[position];
  if (!entry) return { score: 0 };
  const { match } = entry;
  if (match.title === term) return { score: 100 };
  if (match.title.startsWith(term)) return { score: 60 };
  if (match.title.includes(term)) return { score: 40 };
  const heading = match.headings.findIndex((text) => text.includes(term));
  if (heading >= 0) return { score: 25, heading: entry.headings[heading] };
  if (match.description.includes(term)) return { score: 10 };
  if (entry.slug.includes(term)) return { score: 8 };
  if (articleHas({ index, position, term })) return { score: 5 };
  return { score: match.words.some((word) => similarWord({ word, term })) ? 3 : 0 };
}

function scoreEntry({
  index,
  position,
  terms,
}: {
  index: SearchIndex;
  position: number;
  terms: string[];
}): Result | null {
  const entry = index.entries[position];
  if (!entry) return null;
  let score = 0;
  let heading: Heading | undefined;
  for (const term of terms) {
    const hit = scoreTerm({ index, position, term });
    if (!hit.score) return null;
    score += hit.score;
    heading = heading ?? hit.heading;
  }
  return { entry, heading, score };
}

export function searchIndex({ index, query }: { index: SearchIndex; query: string }): Result[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term && !STOP_WORDS.has(term));
  if (terms.length === 0) return [];
  return index.entries
    .map((_, position) => scoreEntry({ index, position, terms }))
    .filter((result): result is Result => result !== null)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}
