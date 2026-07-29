import {
  type ErrorExplanation,
  explainHandledError,
  explainUnhandledError,
} from "./presentation";
import { readEnvelopeTraceId, readHandledError } from "./readHandledError";

/** Everything a surface needs to render an error, resolved once. */
export interface ResolvedErrorCopy {
  /** The headline, with the registry-beats-fallback rule already applied. */
  title: string;
  /** Body copy. Empty when the title says everything. */
  description: string;
  /**
   * Server remediation tips worth showing ALONGSIDE the description — the
   * ones that don't merely repeat it. Never a substitute for reading the
   * description; both are meant to render.
   */
  tips: readonly string[];
  docsUrl: string | undefined;
  traceId: string | undefined;
}

/**
 * The one implementation of "what does this error say to a customer".
 *
 * The toast, the inline alert and `describeError` each used to work this out
 * for themselves, and the two rules involved had drifted: three copies of
 * whose headline wins, and two different answers to whether server tips show
 * next to a registry description. Three implementations of a rule is three
 * chances to get it wrong, and all three were reachable from the same failure.
 *
 * It also parses the error ONCE. Reading title, description, tips, docs link
 * and trace id separately meant four `readHandledError` passes over the same
 * payload on every toast.
 *
 * Two rules live here:
 *
 * 1. **Registry copy beats the caller's fallback.** A code the registry knows
 *    describes this exact failure ("That name is taken"); the caller's
 *    headline only names the action ("Couldn't save"). An unrecognised code
 *    takes the caller's, which at least says what the user was doing.
 * 2. **Tips supplement the description; they don't compete with it.** A tip
 *    that repeats what the description already said is dropped — `query_timeout`
 *    says "narrow the time range" in both — but the rest are kept. Suppressing
 *    all of them whenever the registry had *any* description threw away the
 *    escalation path on nearly every error: `clickhouse_unavailable`'s "check
 *    the status page or contact support" never once reached a customer.
 */
export function resolveErrorCopy({
  error,
  title,
  fallbackTitle,
}: {
  error: unknown;
  /** Hard override of the headline, registry entry or not. Rare. */
  title?: string;
  /** Headline for a failure with no registry copy — "Couldn't save". */
  fallbackTitle?: string;
}): ResolvedErrorCopy {
  const handled = readHandledError(error);
  const explanation: ErrorExplanation = handled
    ? explainHandledError(handled)
    : explainUnhandledError(error);

  return {
    title:
      title ??
      (explanation.isRegistered
        ? explanation.title
        : (fallbackTitle ?? explanation.title)),
    description: explanation.description,
    tips: supplementalTips({
      tips: handled?.tips ?? [],
      description: explanation.description,
    }),
    docsUrl: handled?.docsUrl,
    // Always offered, on every failure. It was briefly withheld from errors
    // judged "self-serviceable" — a rename, an expired share link — on the
    // reasoning that the id only invites a support ticket. That reasoning is
    // wrong twice over: it makes the id's presence a signal in itself, so its
    // ABSENCE becomes information the reader has to interpret, and the one
    // person who needs it most is whoever is on a screen we mis-classified.
    // A cheap affordance nobody has to use beats a clever one that is missing
    // exactly when it matters.
    traceId: handled?.traceId || readEnvelopeTraceId(error),
  };
}

/**
 * The whole explanation as one string, for slots that can only take text —
 * a `title=` tooltip, a state field typed `string`, an aria-label.
 *
 * Prefer `HandledErrorAlert` or `showErrorToast` wherever a component can be
 * rendered: they show the remediation tips, the docs link and the error id,
 * all of which are lost here. This exists so the awkward slots have something
 * better than `error.message`, not as a general-purpose escape hatch.
 */
export function describeError({
  error,
  fallbackTitle,
}: {
  error: unknown;
  fallbackTitle?: string;
}): string {
  const { title, description } = resolveErrorCopy({ error, fallbackTitle });

  return description ? `${title}. ${description}` : title;
}

/**
 * The tips that add something the description didn't already say.
 *
 * Compared on a normalised form — lower-cased, punctuation flattened — because
 * the two authorings are never character-identical: `query_timeout`'s registry
 * description is "Narrow the time range or add a filter, then try again." and
 * its first tip is "Narrow the time range". Containment either way catches
 * both the tip that is a prefix of the description and the tip that swallows
 * it whole.
 */
function supplementalTips({
  tips,
  description,
}: {
  tips: readonly string[];
  description: string;
}): readonly string[] {
  if (!description) return tips;

  const target = normalise(description);
  if (!target) return tips;

  return tips.filter((tip) => {
    const candidate = normalise(tip);
    if (!candidate) return false;
    return !target.includes(candidate) && !candidate.includes(target);
  });
}

/** Words only: two sentences that say the same thing must compare equal. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
