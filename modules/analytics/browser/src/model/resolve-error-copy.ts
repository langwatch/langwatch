import {
  type ErrorExplanation,
  explainHandledError,
  explainUnhandledError,
} from "@langwatch/handled-error/presentation";
import { readEnvelopeTraceId, readHandledError } from "@langwatch/handled-error/read-handled-error";

/** What a failed analytics panel says, resolved once from the code-keyed registry. */
export interface ResolvedErrorCopy {
  /** The headline: registry copy when the code has it, else the caller's fallback. */
  title: string;
  /** One short line of what to do. Empty when the title says everything. */
  description: string;
  docsUrl: string | undefined;
  /** The id a customer quotes to support. */
  traceId: string | undefined;
}

/**
 * The words a failed panel shows. Never `error.message`: since #5984 that is
 * the code slug. Server remediation tips are left out on purpose, since a
 * dashboard can show a dozen failed panels at once.
 */
export function resolveErrorCopy({
  error,
  fallbackTitle,
}: {
  error: unknown;
  /** Headline for a failure the registry has no copy for. */
  fallbackTitle: string;
}): ResolvedErrorCopy {
  const handled = readHandledError(error);
  const explanation: ErrorExplanation = handled
    ? explainHandledError(handled)
    : explainUnhandledError(error);

  return {
    title: explanation.isRegistered ? explanation.title : fallbackTitle,
    description: explanation.description,
    docsUrl: handled?.docsUrl,
    traceId: handled?.traceId || readEnvelopeTraceId(error),
  };
}
