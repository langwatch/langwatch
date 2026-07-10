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
 * The agent-side cheap-model timing and the server "last asked" throttle (so we
 * don't over-ask across turns/conversations) are the backend half — seamed in
 * PR3. On the client, `shouldAskFeedback` is a lightweight localStorage
 * backstop so even the default path respects a minimum interval.
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

const THROTTLE_KEY = "langwatch:langy:feedback:last-asked:v1";
/** Minimum gap between unprompted feedback asks (client backstop). 6 hours. */
const MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Client-side backstop so the DEFAULT (non-directive) feedback affordance
 * doesn't nag: only allow it once per interval. A directive from Langy bypasses
 * this — if the cheap model decided it's a high-signal moment, honour it.
 */
export function shouldAskFeedback(now: number = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(THROTTLE_KEY);
    const last = raw ? Number(raw) : 0;
    return !Number.isFinite(last) || now - last >= MIN_INTERVAL_MS;
  } catch {
    return true;
  }
}

export function markFeedbackAsked(now: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THROTTLE_KEY, String(now));
  } catch {
    // Best-effort.
  }
}
