/**
 * The caller's read-time redactions for one project.
 *
 * The same resolution {@link ApiTraceReadStackPort.getViewerProtections}
 * answers, narrowed to the one question the two surfaces outside the trace
 * feature ask: what may this viewer see of this project's captured content,
 * and may they price it. It is stated here because the trace read stack is
 * what resolves it — the data-privacy policy, the visibility window and the
 * RBAC group facts — and the project and coding-agent surfaces only consume
 * the answer.
 */
export abstract class ApiViewerProtectionsPort {
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
