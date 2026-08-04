/**
 * Structured, hidden directive channel for Langy (ADR-046 frontend).
 *
 * Langy emits hidden in-stream directives the client parses and strips from the
 * displayed text — the same pattern the codebase already uses for
 * `[langy:connect-github]` and `[langy:progress:...]`. This one lets a cheap
 * model on the agent side decide the *moment* to ask for feedback and signal it
 * as `[langy:feedback:<sentiment>]`, so we ask at high-signal times (a clearly
 * great answer, or an obviously rough one) instead of nagging under every reply.
 *
 * WHEN to ask on the default (non-directive) path is the backend's call: the
 * `langy.messages` read carries an `shouldAskFeedback` flag computed by
 * `LangyFeedbackPromptService` (conversation depth + a per-user quiet period),
 * and the panel reports the card being shown back through
 * `langy.feedbackPromptShown` so the cadence holds across tabs and devices.
 * Nothing here keeps client-side timing state.
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

function normalizeSentiment(
  raw: string | undefined,
): LangyFeedbackSentiment | undefined {
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
      return undefined;
  }
}

export function parseLangyFeedbackDirective(
  text: string,
): LangyFeedbackDirective {
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
 *
 * The real "when to ask" decision belongs to Langy's agent-side cheap model,
 * which emits `[langy:feedback]` at a high-signal moment. This is not that — it
 * is only a floor for the throttled backstop path, so we never rate a bare
 * one-word ack ("done", "dev server works") when no directive arrived. It is a
 * content check, deliberately NOT a message-count or turn-index rule. ~55 chars
 * is roughly a full sentence — below that it reads as an ack, not an answer.
 */
const SUBSTANTIVE_ANSWER_MIN_CHARS = 55;

export function isSubstantiveLangyAnswer(text: string): boolean {
  return text.trim().length >= SUBSTANTIVE_ANSWER_MIN_CHARS;
}
