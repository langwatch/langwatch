export interface Protections {
  canSeeCosts?: boolean | undefined | null;
  canSeeCapturedInput?: boolean | undefined | null;
  canSeeCapturedOutput?: boolean | undefined | null;
  // When input/output is hidden by a `restrict` privacy policy, a human label of
  // who CAN see it (e.g. "Admins, Security group"), for the trace-view
  // placeholder. Null/absent when the content is visible.
  capturedInputVisibleTo?: string | null;
  capturedOutputVisibleTo?: string | null;
  // Custom attribute rules (restrict disposition) whose audience excludes THIS
  // viewer: the read mappers replace matching attribute values with a redaction
  // placeholder naming `visibleTo`. Patterns may carry `*` wildcards. Absent or
  // empty when nothing is hidden for the viewer.
  hiddenAttributes?: Array<{ pattern: string; visibleTo: string }>;
}
