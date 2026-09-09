/**
 * Structured, hidden directive channel for Langy (ADR-046 frontend).
 */

export type LangyFeedbackSentiment = "frustrated" | "delighted" | "neutral";

export interface LangyFeedbackDirective {
  /** True when Langy asked for feedback at this point in the stream. */
  requested: boolean;
  /** The moment Langy classified this as, tailoring the prompt copy. */
  sentiment?: LangyFeedbackSentiment;
  /** The text with the directive stripped, safe to render. */
  cleanedText: string;
}

// [langy:feedback] or [langy:feedback:delighted] / :frustrated / :neutral, plus
// the friction aliases the agent might emit.
const DIRECTIVE_RE =
  /\[langy:feedback(?::(frustrated|delighted|neutral|high-friction|low-friction))?\]/gi;

function normalizeSentiment(raw: string | undefined): LangyFeedbackSentiment | undefined {
  switch (raw?.toLowerCase()) {
    case "frustrated":
    case "high-friction":
      return "frustrated";
    case "delighted":
    case "low-friction":
      return "delighted";
    case "neutral":
      return "neutral";
    default:
      return void 0;
  }
}

export function parseLangyFeedbackDirective(text: string): LangyFeedbackDirective {
  let requested = false;
  let sentiment: LangyFeedbackSentiment | undefined;
  const cleanedText = text
    .replace(DIRECTIVE_RE, (_match, group: string | undefined) => {
      requested = true;
      sentiment = sentiment ?? normalizeSentiment(group);
      return "";
    })
    .trim();
  return { requested, sentiment, cleanedText };
}

/**
 * Substance floor for the DEFAULT (non-directive) feedback ask.
 */
const SUBSTANTIVE_ANSWER_MIN_CHARS = 55;

export function isSubstantiveLangyAnswer(text: string): boolean {
  return text.trim().length >= SUBSTANTIVE_ANSWER_MIN_CHARS;
}
