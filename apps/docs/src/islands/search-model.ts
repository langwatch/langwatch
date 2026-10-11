import { z } from "zod";

export const searchEntrySchema = z.object({
  slug: z.string(),
  method: z.string().default(""),
  title: z.string(),
  section: z.string(),
  description: z.string(),
  trail: z.string().default(""),
  body: z.string().default(""),
  headings: z.array(z.object({ id: z.string(), text: z.string() })),
});
export type SearchEntry = z.infer<typeof searchEntrySchema>;

type Result = { entry: SearchEntry; heading?: { id: string; text: string }; score: number };

const MAX_RESULTS = 20;

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

function scoreTerm({ entry, term }: { entry: SearchEntry; term: string }): {
  score: number;
  heading?: Result["heading"];
} {
  const title = entry.title.toLowerCase();
  if (title === term) return { score: 100 };
  if (title.startsWith(term)) return { score: 60 };
  if (title.includes(term)) return { score: 40 };
  const heading = entry.headings.find((candidate) => candidate.text.toLowerCase().includes(term));
  if (heading) return { score: 25, heading };
  if (entry.description.toLowerCase().includes(term)) return { score: 10 };
  if (entry.slug.includes(term)) return { score: 8 };
  if (entry.body.toLowerCase().includes(term)) return { score: 5 };
  const words = `${title} ${entry.description} ${entry.trail}`.toLowerCase().split(/[^a-z0-9_]+/);
  return { score: words.some((word) => similarWord({ word, term })) ? 3 : 0 };
}

function scoreEntry({ entry, terms }: { entry: SearchEntry; terms: string[] }): Result | null {
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

export function searchIndex({ index, query }: { index: SearchEntry[]; query: string }): Result[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term && !["how", "do", "i", "a", "the", "to", "is"].includes(term));
  if (terms.length === 0) return [];
  return index
    .map((entry) => scoreEntry({ entry, terms }))
    .filter((result): result is Result => result !== null)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}
