/**
 * One style for every Langy conversation title.
 *
 * A title reaches the recent-chats list from two places: the cheap model that
 * writes one after the first successful turn, and the first user message, which
 * derives a placeholder before any model has answered. Both go through this
 * normaliser, so the list reads in a single voice.
 *
 * The style is sentence case: only the first word is capitalised, plus the
 * words that carry their own capitals anywhere they appear (LangWatch, GitHub,
 * API). There is no trailing period, no surrounding quotes, and a title is at
 * most `LANGY_TITLE_GENERATION.MAX_TITLE_CHARS` characters, cut on a word
 * boundary.
 *
 * @see specs/langy/langy-conversation-title.feature
 */

import { LANGY_TITLE_GENERATION } from "@langwatch/langy";

/**
 * Words that keep their capital in the middle of a sentence. Sentence case
 * lower-cases an ordinary capitalised word, and these are not ordinary: they
 * are product, company and language names people write with a capital wherever
 * they appear, plus the pronoun "I". Words that already carry an inner capital
 * or are written in full upper case (LangWatch, GitHub, API, PostgreSQL) need
 * no entry here, because the rule below never touches them.
 */
const ALWAYS_CAPITALISED = new Set([
  "i",
  "anthropic",
  "azure",
  "bedrock",
  "claude",
  "clickhouse",
  "datadog",
  "docker",
  "gemini",
  "google",
  "grafana",
  "java",
  "kubernetes",
  "linear",
  "notion",
  "postgres",
  "python",
  "redis",
  "ruby",
  "sentry",
  "slack",
  "stripe",
  "vercel",
]);

/** An ordinary capitalised word: one capital, then lower case letters only. */
const CAPITALISED_WORD = /^[A-Z][a-z]*(?:['’][a-z]+)?$/;

/**
 * Bring a raw title into the one style, whatever wrote it.
 *
 * Returns an empty string when nothing usable is left, which the callers read
 * as "no title".
 */
export function normalizeLangyConversationTitle(raw: string): string {
  let out = unwrap(raw);
  out = out.replace(/\s+/g, " ").trim();
  out = truncateOnWordBoundary(out, LANGY_TITLE_GENERATION.MAX_TITLE_CHARS);
  out = stripTrailingPunctuation(out);
  return sentenceCase(out);
}

/** Strip the fences, labels and quotes an LLM adds despite instructions. */
function unwrap(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  out = out.replace(/^(?:title|chat|conversation)\s*[:=]\s*/i, "");
  out = out.trim();
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'")) ||
    (out.startsWith("“") && out.endsWith("”"))
  ) {
    out = out.slice(1, -1);
  }
  return stripTrailingPunctuation(out.trim());
}

/** A question mark is part of the title; a period or a comma is not. */
function stripTrailingPunctuation(text: string): string {
  return text.replace(/[.,;:!\s]+$/, "").trim();
}

function truncateOnWordBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/**
 * Capitalise the first character, and lower-case every later word that is
 * merely capitalised. A word written in upper case or with an inner capital is
 * left exactly as it is, so LangWatch, API and PostgreSQL survive a title the
 * model wrote in title case.
 */
function sentenceCase(text: string): string {
  if (!text) return "";
  const words = text.split(" ");
  const rest = words.slice(1).map((word) =>
    word
      .split("-")
      .map((piece) => lowerCaseOrdinaryWord(piece))
      .join("-"),
  );
  return [capitaliseFirst(words[0] ?? ""), ...rest].join(" ");
}

function lowerCaseOrdinaryWord(word: string): string {
  const lead = /^[^A-Za-z]*/.exec(word)?.[0] ?? "";
  const core = word.slice(lead.length).replace(/[^A-Za-z'’]+$/, "");
  const tail = word.slice(lead.length + core.length);
  if (!CAPITALISED_WORD.test(core)) return word;
  if (ALWAYS_CAPITALISED.has(core.toLowerCase())) return word;
  return `${lead}${core.toLowerCase()}${tail}`;
}

function capitaliseFirst(word: string): string {
  const at = word.search(/[A-Za-z]/);
  if (at === -1) return word;
  return word.slice(0, at) + word.charAt(at).toUpperCase() + word.slice(at + 1);
}
