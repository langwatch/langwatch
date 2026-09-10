import type { Protections } from "@langwatch/trace-contract";

/**
 * The caller's read-time redactions for one project.
 */
export abstract class ApiViewerProtections {
  /**
   * The same redactions for a viewer the caller has ALREADY resolved. A
   * surface that holds a user id rather than a request context reads through
   * this one.
   */
  abstract readViewerProtections(
    input: Readonly<{ projectId: string; userId: string }>,
  ): Promise<
    Readonly<{
      canSeeCosts?: boolean | null;
      canSeeCapturedInput?: boolean | null;
      canSeeCapturedOutput?: boolean | null;
    }>
  >;

  abstract getViewerProtections(
    ctx: unknown,
    input: Readonly<{ projectId: string }>,
  ): Promise<
    Readonly<{
      canSeeCosts?: boolean | null;
      canSeeCapturedInput?: boolean | null;
      canSeeCapturedOutput?: boolean | null;
      capturedInputVisibleTo?: string | null;
      capturedOutputVisibleTo?: string | null;
    }>
  >;
}

/**
 * The redactions taken off the process's own trace READ stack.
 *
 * The same resolution the five trace surfaces read through, handed to the project and
 * coding-agent features so `project.getFieldRedactionStatus` and `codingAgents.sessionsList`
 * answer instead of refusing. A second resolver would let one screen show a field another
 * hides.
 */
export class ApiTraceReadViewerProtections extends ApiViewerProtections {
  static create(reads: ApiTraceViewerProtectionsSource): ApiTraceReadViewerProtections {
    return new ApiTraceReadViewerProtections(reads);
  }

  private constructor(private readonly reads: ApiTraceViewerProtectionsSource) {
    super();
  }

  readViewerProtections(
    input: Readonly<{ projectId: string; userId: string }>,
  ): Promise<Protections> {
    return this.reads.readViewerProtections(input);
  }

  getViewerProtections(ctx: unknown, input: Readonly<{ projectId: string }>): Promise<Protections> {
    return this.reads.getViewerProtections(ctx, input);
  }
}

/** The two reads this adapter takes off the trace read stack. */
type ApiTraceViewerProtectionsSource = Readonly<{
  getViewerProtections(ctx: unknown, input: Readonly<{ projectId: string }>): Promise<Protections>;
  readViewerProtections(
    input: Readonly<{ projectId: string; userId: string }>,
  ): Promise<Protections>;
}>;
