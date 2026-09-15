import {
  type ErrorExplanation,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "@langwatch/handled-error/presentation";
import { nodeErrorToDomainError } from "@langwatch/workflow-contract";

/**
 * An errored execution state, as the studio reads it.
 */
export interface CodedExecutionFailure {
  error_type?: string;
  upstream_status?: number;
  trace_id?: string;
  span_id?: string;
  error?: string;
}

/** What a customer reads when a run, a step, or the stream itself fails. */
/**
 * The failure as the application reads it: the engine's own serialised
 * handled error, or `undefined` when the frame carried no code at all.
 */
export function reportableExecutionFailure(
  state: CodedExecutionFailure | undefined | null,
): unknown {
  if (state?.error_type) {
    return nodeErrorToDomainError({
      errorType: state.error_type,
      upstreamStatus: state.upstream_status,
      traceId: state.trace_id,
      spanId: state.span_id,
    });
  }

  // Uncoded, but traced: the id is the only thing on the frame that may be
  // shown, and it is the one handle a customer has to give support. It travels
  // in the envelope shape every boundary hangs a trace off, so the application
  // finds it without a slot of its own on the port.
  return state?.trace_id ? { trace: { traceId: state.trace_id } } : void 0;
}

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

  // The caller's title survives even for a coded failure, which it did NOT do
  // in `platform/app`: there the registry had a better title for a code it
  // listed. The registry is the composing application's and did not travel, so
  // the honest title here is the one naming what was being attempted. What the
  // code still buys is a toast of its own — see the dedupe id in `usePostEvent`.
  if (coded?.isRegistered) {
    return { ...coded, title: fallbackTitle ?? coded.title, traceId };
  }

  return {
    title: fallbackTitle ?? UNKNOWN_ERROR_PRESENTATION.title,
    description: traceId ? UNKNOWN_ERROR_PRESENTATION.description : "",
    isRegistered: false,
    traceId,
  };
}
