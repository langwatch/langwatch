import {
  type ErrorExplanation,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "~/features/errors";
import { nodeErrorToDomainError } from "~/server/experiments-v3/execution/nodeErrorDomain";

/**
 * An errored execution state, as the studio reads it.
 *
 * `error` is the engine's engineer-facing message
 * (`httpblock: Post "…": lookup api.example.com: no such host`). It is not
 * copy, and a coded failure never shows it — but see
 * {@link explainExecutionStateError} for why it is on this type rather than
 * excluded from it.
 */
export interface CodedExecutionFailure {
  error_type?: string;
  upstream_status?: number;
  trace_id?: string;
  span_id?: string;
  error?: string;
}

/** Long enough for a sentence, short enough not to be a wall of Go. */
const MAX_RAW_LENGTH = 160;

/**
 * Turns an errored execution state into the words a customer reads.
 *
 * A coded failure presents from the registry, like everywhere else in the app.
 *
 * An UNCODED one falls back to the raw message, and that is deliberate. The
 * first version of this degraded everything uncoded to the generic
 * "Something went wrong / We've been notified", which turned out to be both a
 * regression and a lie:
 *
 *   - `useComponentExecution` synthesises `{ error: "Timeout" }` for a local
 *     20s client-side timeout. Nothing was reported to anyone, and "try again
 *     in a moment" is precisely the wrong advice.
 *   - the stream's top-level `error` frame carries no code at all, and its
 *     message is written by our own control plane ("the runtime is
 *     unreachable"), not by the engine.
 *   - the optimization runner never stamps a code either.
 *
 * "We've been notified" has to be true when we say it. Where there is no code,
 * the message we have beats a comforting sentence that isn't accurate — this
 * is a builder surface, and the person reading it is debugging a workflow they
 * wrote. It is capped so a Go stack can't fill the toast.
 */
export function explainExecutionStateError(
  state: CodedExecutionFailure | undefined | null,
): ErrorExplanation {
  if (state?.error_type) {
    return explainSerializedError(
      nodeErrorToDomainError({
        errorType: state.error_type,
        upstreamStatus: state.upstream_status,
        traceId: state.trace_id,
        spanId: state.span_id,
      }),
    );
  }

  const raw = state?.error?.trim();
  if (!raw) return UNKNOWN_ERROR_PRESENTATION;

  return {
    title: "That step didn't run",
    description:
      raw.length > MAX_RAW_LENGTH
        ? `${raw.slice(0, MAX_RAW_LENGTH - 1)}…`
        : raw,
    isRegistered: false,
  };
}
