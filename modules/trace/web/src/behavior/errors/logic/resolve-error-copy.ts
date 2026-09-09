import {
  type ErrorExplanation,
  explainHandledError,
  explainUnhandledError,
} from "@langwatch/handled-error/presentation";
import { readEnvelopeTraceId, readHandledError } from "@langwatch/handled-error/read-handled-error";

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
 * What an INLINE failure surface in this package says to a customer.
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
      (explanation.isRegistered ? explanation.title : (fallbackTitle ?? explanation.title)),
    description: explanation.description,
    tips: supplementalTips({
      tips: handled?.tips ?? [],
      description: explanation.description,
    }),
    docsUrl: handled?.docsUrl,
    // Always offered, on every failure. It was briefly withheld from errors judged
    // "self-serviceable" — a rename, an expired share link — on the reasoning that the
    // id only invites a support ticket.
    traceId: handled?.traceId || readEnvelopeTraceId(error),
  };
}

/**
 * The tips that add something the description didn't already say.
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
