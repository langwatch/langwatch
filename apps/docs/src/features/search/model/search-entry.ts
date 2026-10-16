import { z } from "zod/mini";

export const searchEntrySchema = z.object({
  slug: z.string(),
  method: z._default(z.string(), ""),
  title: z.string(),
  section: z.string(),
  description: z.string(),
  trail: z._default(z.string(), ""),
  body: z._default(z.string(), ""),
  headings: z.array(z.object({ id: z.string(), text: z.string() })),
});
export type SearchEntry = z.infer<typeof searchEntrySchema>;
/** An entry as published in search-index.json, before defaults are applied. */
export type PublishedSearchEntry = z.input<typeof searchEntrySchema>;

/** An entry with its text lowercased once at load, so a keystroke never lowercases the corpus. */
export type IndexedEntry = SearchEntry & {
  match: { title: string; description: string; body: string; headings: string[]; words: string[] };
};

type Result = { entry: IndexedEntry; heading?: { id: string; text: string }; score: number };

const MAX_RESULTS = 20;
const STOP_WORDS = new Set(["how", "do", "i", "a", "the", "to", "is"]);

export function indexEntries({ entries }: { entries: SearchEntry[] }): IndexedEntry[] {
  return entries.map((entry) => {
    const title = entry.title.toLowerCase();
    const description = entry.description.toLowerCase();
    const words = `${title} ${description} ${entry.trail.toLowerCase()}`.split(/[^a-z0-9_]+/);
    return {
      ...entry,
      match: {
        title,
        description,
        body: entry.body.toLowerCase(),
        headings: entry.headings.map((heading) => heading.text.toLowerCase()),
        words: [...new Set(words)].filter((word) => word.length >= 4),
      },
    };
  });
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

function scoreTerm({ entry, term }: { entry: IndexedEntry; term: string }): {
  score: number;
  heading?: Result["heading"];
} {
  const { match } = entry;
  if (match.title === term) return { score: 100 };
  if (match.title.startsWith(term)) return { score: 60 };
  if (match.title.includes(term)) return { score: 40 };
  const heading = match.headings.findIndex((text) => text.includes(term));
  if (heading >= 0) return { score: 25, heading: entry.headings[heading] };
  if (match.description.includes(term)) return { score: 10 };
  if (entry.slug.includes(term)) return { score: 8 };
  if (match.body.includes(term)) return { score: 5 };
  return { score: match.words.some((word) => similarWord({ word, term })) ? 3 : 0 };
}

function scoreEntry({ entry, terms }: { entry: IndexedEntry; terms: string[] }): Result | null {
  let score = 0;
  let heading: Result["heading"];
  for (const term of terms) {
    const hit = scoreTerm({ entry, term });
    if (!hit.score) return null;
    score += hit.score;
    heading = heading ?? hit.heading;
  }
  return { entry, heading, score };
}

export function searchIndex({ index, query }: { index: IndexedEntry[]; query: string }): Result[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term && !STOP_WORDS.has(term));
  if (terms.length === 0) return [];
  return index
    .map((entry) => scoreEntry({ entry, terms }))
    .filter((result): result is Result => result !== null)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}
