/**
 * The caller's read-time redactions for one project.
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
