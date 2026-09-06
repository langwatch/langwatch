/**
 * The reviewer's trace content for an annotation queue, over this process's own trace stack.
 *
 * The queue lists whole traces to review, so it resolves them IN FULL — the 64 KB stored
 * preview is a digest, and an annotator labelling content has to see the value they are
 * labelling (#4991). The redactions are the reviewer's own, resolved through the SAME pass
 * every trace surface reads through, so a field the explorer hides is not revealed here.
 */
import type { Trace } from "@langwatch/trace-contract";
import { ApiAnnotationTraceContentPort } from "./annotation.composition";

/** The two reads this adapter takes off the process's trace half. */
export type ApiAnnotationTraceSource = Readonly<{
  /** The caller's read-time redactions for one project. */
  getViewerProtections(ctx: unknown, input: Readonly<{ projectId: string }>): Promise<unknown>;
  /** Named traces with their spans, resolved in full. */
  readTracesWithSpans(input: {
    projectId: string;
    traceIds: string[];
    protections: unknown;
  }): Promise<Trace[]>;
}>;

export class ApiTraceAnnotationContent extends ApiAnnotationTraceContentPort {
  static create(source: ApiAnnotationTraceSource): ApiTraceAnnotationContent {
    return new ApiTraceAnnotationContent(source);
  }

  private constructor(private readonly source: ApiAnnotationTraceSource) {
    super();
  }

  async loadTraces(input: {
    userId: string;
    projectId: string;
    traceIds: readonly string[];
  }): Promise<ReadonlyArray<Trace>> {
    // The redaction pass identifies the reader by session, and the queue read carries the id
    // rather than the request, so the id is presented in the shape that pass reads.
    const protections = await this.source.getViewerProtections(
      { session: { user: { id: input.userId } } },
      { projectId: input.projectId },
    );

    return this.source.readTracesWithSpans({
      projectId: input.projectId,
      traceIds: [...input.traceIds],
      protections,
    });
  }
}
