/**
 * The stages a run report passes through, and what to call them on screen.
 *
 * Lives in `shared/` because both sides need it and neither owns it: the
 * server names the stage it has entered, the browser renders the label. Kept
 * out of `server/export/...` deliberately - a client component importing a
 * value (not a type) from under `server/` pulls that module's whole graph into
 * the browser bundle, and this feature has already broken a page that way
 * once. A type-only import is erased; a constant is not.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

export const REPORT_STAGES = [
  "reading",
  "measuring",
  "writing",
  "checking",
  "rendering",
] as const;

export type ReportStage = (typeof REPORT_STAGES)[number];

/**
 * What each stage is called while someone waits on it.
 *
 * Said in terms of what is happening to their run, not of the pipeline that
 * happens to implement it.
 */
export const REPORT_STAGE_LABELS: Readonly<Record<ReportStage, string>> = {
  reading: "Reading the run",
  measuring: "Working out what happened",
  writing: "Langy is writing the analysis",
  checking: "Langy is checking it against the run",
  rendering: "Putting the report together",
};

/** Called as each stage begins, so a caller can say where the wait is. */
export type ReportProgress = (stage: ReportStage) => void;
