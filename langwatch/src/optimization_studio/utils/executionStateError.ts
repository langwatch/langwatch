import {
  type ErrorExplanation,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "~/features/errors";
import { nodeErrorToDomainError } from "~/server/experiments-v3/execution/nodeErrorDomain";

/**
 * The coded half of an execution state — everything the studio is allowed to
 * show a customer about a failure.
 *
 * Deliberately excludes `error`: that string is the engine's engineer-facing
 * message (`httpblock: Post "…": lookup api.example.com: no such host`) and
 * belongs in the debug panel and the logs, never in a toast. See ADR-045 and
 * `ExecutionState` in `../types/dsl`.
 */
export interface CodedExecutionFailure {
  error_type?: string;
  upstream_status?: number;
  trace_id?: string;
  span_id?: string;
}

/**
 * Turns an errored execution state into the words a customer reads, via the
 * same code-keyed registry the rest of the app presents from.
 *
 * An older engine (or a path that never carried a code, like the optimization
 * runner) yields no `error_type`; that degrades to the calm generic state
 * rather than falling back to the raw message.
 */
export function explainExecutionStateError(
  state: CodedExecutionFailure | undefined | null,
): ErrorExplanation {
  if (!state?.error_type) return UNKNOWN_ERROR_PRESENTATION;

  return explainSerializedError(
    nodeErrorToDomainError({
      errorType: state.error_type,
      upstreamStatus: state.upstream_status,
      traceId: state.trace_id,
      spanId: state.span_id,
    }),
  );
}
