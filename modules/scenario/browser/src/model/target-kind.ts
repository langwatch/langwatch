/**
 * What is behind a target: the kind of agent a run points at. The mark
 * draws it, results tables group by it, the name map resolves it — the
 * family's vocabulary, not one component's prop type.
 */
export type TargetKind =
  | "signature"
  | "prompt"
  | "code"
  | "http"
  | "workflow"
  | "connected"
  /** More than one target under one row, such as a plan that compares two. */
  | "several"
  /** A target the page holds nothing about, such as a run from code. */
  | "unknown";
