import {
  type ErrorExplanation,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "~/features/errors";
import { nodeErrorToDomainError } from "@langwatch/workflow-contract";

/**
 * An errored execution state, as the studio reads it.
 *
 * `error` is the engine's engineer-facing message
 * (`httpblock: Post "…": lookup api.example.com: no such host`). It is not
 * copy and nothing here renders it — it is on this type because
 * {@link isDeliberateStop} still reads it to tell a stop from a failure on the
 * frames that carry no code, and because the node properties panel shows it
 * verbatim under "Error", which is the one surface where an engineer is
 * looking for exactly that string.
 */
export interface CodedExecutionFailure {
  error_type?: string;
  upstream_status?: number;
  trace_id?: string;
  span_id?: string;
  error?: string;
}

/**
 * What a customer reads when a run, a step, or the stream itself fails.
 *
 * A coded failure presents from the registry, like everywhere else in the app.
 *
 * Everything else degrades to the generic unknown state. That is ADR-045 §3
 * ("an unhandled failure's raw detail is logged server-side with the trace id,
 * never presented to the client"), and the message this used to fall back on
 * is precisely the detail that rule is about: the stream's top-level `error`
 * frame is arbitrary text that can name a URL or a Go net error, and the
 * optimization runner's is no better vetted. The engine's words are not lost —
 * they are in the node properties panel, under "Error", where somebody
 * debugging the workflow they wrote goes looking.
 *
 * An UNRECOGNISED code takes the same path. It means one of two things: an
 * engine newer than this browser tab, or a code nobody wrote copy for. Neither
 * is something to render a slug at a customer for.
 *
 * Two things keep this from being the vague dead-end "Something went wrong"
 * usually is:
 *
 *   - `fallbackTitle`, which the caller uses to name what was being attempted
 *     ("This run didn't finish"), exactly as `showErrorToast` does. A code the
 *     registry knows keeps its own better title.
 *   - the trace id, which the caller renders as a copyable error id. It is
 *     also what makes "we've been notified" safe to SAY: that sentence appears
 *     only when there is a trace id, i.e. only when there is a log line on our
 *     side to be notified by. A client-side failure with no trace (the studio's
 *     own 20s component-execution timeout) gets the caller's title and no
 *     promise nobody kept.
 */
export function explainExecutionStateError({
  state,
  fallbackTitle,
}: {
  state: CodedExecutionFailure | undefined | null;
  fallbackTitle?: string;
}): ErrorExplanation & { traceId?: string } {
  const traceId = state?.trace_id;

  const coded = state?.error_type
    ? explainSerializedError(
        nodeErrorToDomainError({
          errorType: state.error_type,
          upstreamStatus: state.upstream_status,
          traceId: state.trace_id,
          spanId: state.span_id,
        }),
      )
    : null;

  if (coded?.isRegistered) return { ...coded, traceId };

  return {
    title: fallbackTitle ?? UNKNOWN_ERROR_PRESENTATION.title,
    description: traceId ? UNKNOWN_ERROR_PRESENTATION.description : "",
    isRegistered: false,
    traceId,
  };
}
