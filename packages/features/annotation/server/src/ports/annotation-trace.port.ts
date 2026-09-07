/**
 * The trace half, as annotation needs it.
 *
 * Every method here is another feature's storage: which of a set of ids
 * addresses a trace this project holds, the content behind a queue item with
 * the reviewer's own redactions applied, the correction a suggested output is
 * written into, and the trace-side record that a human commented. Annotation
 * owns none of that and never reaches for it directly — the process installing
 * this feature provides the port.
 */
import type { resolveAnnotationSuggestionTarget } from "@langwatch/annotation-contract";
import type { Trace } from "@langwatch/trace-contract";

/** What one suggestion rewrites: a span field, or a trace's own input/output. */
export type AnnotationSuggestionTarget = NonNullable<
  ReturnType<typeof resolveAnnotationSuggestionTarget>
>;

/** The trace-side record of one comment, as the pipeline carries it. */
export type AnnotationTraceMarker = Readonly<{
  tenantId: string;
  traceId: string;
  annotationId: string;
  occurredAt: number;
}>;

export abstract class AnnotationTracePort {
  /**
   * Which of these ids this project actually holds a trace for. An empty answer
   * is a real one: a deployment with no trace storage holds no trace to queue.
   */
  abstract findExistingTraceIds(
    input: Readonly<{ projectId: string; traceIds: readonly string[] }>,
  ): Promise<string[]>;

  /**
   * The traces behind a set of queue items, resolved IN FULL and with the
   * reviewer's own read-time redactions already applied (#4991).
   */
  abstract loadTraces(
    input: Readonly<{ userId: string; projectId: string; traceIds: readonly string[] }>,
  ): Promise<ReadonlyArray<Trace>>;

  /**
   * Writes one suggestion into the trace's correction, or takes it back off
   * when the reviewer cleared the text.
   */
  abstract writeSuggestion(
    input: Readonly<{
      projectId: string;
      traceId: string;
      target: AnnotationSuggestionTarget;
      text: string;
      userId: string;
    }>,
  ): Promise<void>;

  /** Records on the trace that a human has commented on it. Best effort. */
  abstract recordAnnotation(input: AnnotationTraceMarker): Promise<void>;

  /** Takes that record back off when the comment goes. Best effort. */
  abstract removeAnnotation(input: AnnotationTraceMarker): Promise<void>;
}
