/**
 * One style for every Langy conversation title. Sentence case, no trailing
 * period/quotes, cut on a word boundary at `MAX_TITLE_CHARS`.
 * @see specs/langy/langy-conversation-title.feature
 */

import { LANGY_TITLE_GENERATION } from "@langwatch/langy-contract";

/**
 * Words that keep their capital mid-sentence: product/company/language names
 * plus "I". Words with an inner capital or full upper case (LangWatch, API)
 * need no entry — the rule below never touches them.
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

/** Bring a raw title into the one style. Empty string means "no title". */
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
  const isWrappedInQuotes =
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'")) ||
    (out.startsWith("“") && out.endsWith("”"));
  if (isWrappedInQuotes) {
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
 * Capitalise the first character, lower-case every later merely-capitalised
 * word. Upper case or inner-capital words (LangWatch, API) are left as-is.
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
  const lowercasedCore = core.toLowerCase();
  if (ALWAYS_CAPITALISED.has(lowercasedCore)) return word;
  return `${lead}${core.toLowerCase()}${tail}`;
}

function capitaliseFirst(word: string): string {
  const at = word.search(/[A-Za-z]/);
  if (at === -1) return word;
  return word.slice(0, at) + word.charAt(at).toUpperCase() + word.slice(at + 1);
}
