import { z } from "zod";
import type { RunOutcomeCounts } from "~/server/scenarios/run-outcome-summary";
import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { RunStatusCategory } from "~/server/scenarios/scenario-run-category";

/**
 * Shapes for the run report: what the deterministic layer computes, what a
 * model is allowed to add, and what the renderer turns into a document.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

export const batchRunReportRequestSchema = z.object({
  projectId: z.string(),
  scenarioSetId: z.string(),
  batchRunId: z.string(),
  /**
   * What the run is called on screen.
   *
   * Supplied by the caller because the run records carry a scenario set id, not
   * the suite's display name, and a report headed by an opaque id is worse than
   * one headed by the words the person was just looking at. Treated as
   * untrusted text: escaped when rendered, stripped when it reaches a filename.
   */
  suiteName: z.string().max(200).optional(),
});
export type BatchRunReportRequest = z.infer<typeof batchRunReportRequestSchema>;

/**
 * How much of the report survived being produced.
 *
 * Named rather than boolean because the reader needs to know WHICH half is
 * missing: figures with no writing is a different document from writing that
 * nobody checked. There is no tier in which the download fails.
 */
export type ReportTier = "verified" | "unchecked" | "figures_only";

/** Which of the three acts a question belongs to. */
export type QuestionTier = "past" | "present" | "future";

// ============================================================================
// Evidence — computed with no model involvement, and the only thing a model sees
// ============================================================================

/** One scenario run, flattened to what the report reasons about. */
export interface RunFact {
  runId: string;
  scenarioId: string;
  scenarioName: string;
  status: ScenarioRunStatus;
  category: RunStatusCategory;
  verdict: string | null;
  reasoning: string | null;
  metCriteria: string[];
  unmetCriteria: string[];
  error: string | null;
  turnCount: number;
  durationMs: number;
  cost: number | null;
}

/**
 * One criterion, tallied across the run.
 *
 * `criterionId` is derived from the scenario plus the normalised criterion
 * text, so the same criterion is recognisable across runs and a trend can be
 * computed. Criteria are free text, so rewording one legitimately produces a
 * new id — the trend calls that "new" rather than pretending continuity.
 */
export interface CriterionFact {
  criterionId: string;
  scenarioId: string;
  text: string;
  metCount: number;
  unmetCount: number;
  metRunIds: string[];
  unmetRunIds: string[];
}

/**
 * A group of runs that failed the same way, derived without a model.
 *
 * Judged failures, infrastructure errors and stalls are never mixed: a run that
 * errored before the judge saw it revealed nothing about the agent, and burying
 * it among real failures hides the ones that matter.
 */
export interface FailureSignature {
  signatureId: string;
  kind: "judged" | "errored" | "stalled" | "cancelled";
  unmetCriterionIds: string[];
  errorShape: string | null;
  runIds: string[];
  scenarioIds: string[];
}

export type CriterionOutcome = "met" | "unmet" | "absent";

export type TrendClassification =
  | "regression"
  | "fixed"
  | "long_standing"
  | "unreliable"
  | "new"
  | "stable_pass"
  | "stable_fail";

export interface TrendFact {
  criterionId: string;
  scenarioId: string;
  text: string;
  classification: TrendClassification;
  currentOutcome: CriterionOutcome;
  /** Oldest first, current run last. */
  history: { batchRunId: string; outcome: CriterionOutcome }[];
  /** Consecutive runs ending at this one with the current outcome. */
  streakBatches: number;
}

export interface CoverageFact {
  scenariosInSuite: { scenarioId: string; name: string }[];
  scenariosNotRun: { scenarioId: string; name: string }[];
  /** Criteria that have never once failed, across every run we can see. */
  neverFailed: { criterionId: string; text: string; batches: number }[];
}

/**
 * The headline rate, with an honest read on whether it means anything.
 *
 * A Wilson interval rather than a bare percentage, because three failures out
 * of four is not a 75% failure rate in any sense worth rewriting a prompt over.
 */
export interface PassRateFact {
  value: number | null;
  ci95: { low: number; high: number } | null;
  settled: number;
  tooFewToConclude: boolean;
}

export interface PriorBatchFact {
  batchRunId: string;
  startedAt: number;
  passRate: number | null;
  settled: number;
}

/** What the model was and was not shown, so the report can say so. */
export interface TruncationFact {
  failingRuns: number;
  transcriptsIncluded: number;
  signaturesCovered: number;
  signaturesTotal: number;
}

export interface ReportEvidence {
  batch: {
    batchRunId: string;
    scenarioSetId: string;
    suiteName: string | null;
    startedAt: number;
    durationMs: number;
    totalCost: number | null;
  };
  counts: RunOutcomeCounts;
  passRate: PassRateFact;
  runs: RunFact[];
  criteria: CriterionFact[];
  signatures: FailureSignature[];
  trend: TrendFact[];
  coverage: CoverageFact;
  priorBatches: PriorBatchFact[];
  truncation: TruncationFact;
  /** True when scenarios were still running, so the figures cover a subset. */
  stillRunning: boolean;
}

// ============================================================================
// Citations — what makes a model statement admissible
// ============================================================================

export const citationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run"), runId: z.string() }),
  z.object({ kind: z.literal("criterion"), criterionId: z.string() }),
  z.object({ kind: z.literal("signature"), signatureId: z.string() }),
  z.object({
    kind: z.literal("turn"),
    runId: z.string(),
    turnIndex: z.number().int().min(0),
  }),
  z.object({ kind: z.literal("stat"), path: z.string() }),
]);
export type Citation = z.infer<typeof citationSchema>;

export interface Claim {
  /** Assigned by us, never by the model — the checker refers to claims by it. */
  id: string;
  text: string;
  citations: Citation[];
}

export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  headline: string;
  severity: Severity;
  /** What the computed prior said, shown alongside when the two disagree. */
  computedSeverity: Severity;
  consequence: string;
  claims: Claim[];
}

export interface Artifact {
  artifactType: "scenario" | "system_prompt_amendment" | "guardrail_rule";
  title: string;
  rationale: string;
  body: string;
  claims: Claim[];
}

// ============================================================================
// Renderable blocks — the deterministic layer's output, and the model's
// ============================================================================

export type Tone = "pass" | "fail" | "warn" | "muted" | "neutral";

export interface TableCell {
  text: string;
  tone?: Tone;
  /** Sort key when the rendered text is not sortable (durations, dates). */
  sortValue?: number | string;
}

/**
 * One piece of renderable content.
 *
 * A small closed set on purpose: a new question that reuses an existing block
 * needs no rendering code at all, which is what keeps the registry cheap to
 * extend. A genuinely new SHAPE costs a variant here plus a renderer, and that
 * is the honest boundary of the extensibility claim.
 */
export type Block =
  | { kind: "stats"; stats: { label: string; value: string; hint?: string }[] }
  | { kind: "bar"; segments: { label: string; value: number; tone: Tone }[] }
  | { kind: "table"; columns: string[]; rows: TableCell[][] }
  | { kind: "list"; items: { text: string; tone?: Tone }[] }
  | {
      kind: "groups";
      groups: {
        title: string;
        subtitle: string;
        tone?: Tone;
        detail: { label: string; body: string }[];
      }[];
    }
  | { kind: "note"; text: string; tone?: Tone }
  | { kind: "claims"; claims: Claim[] }
  | { kind: "findings"; findings: Finding[] }
  | { kind: "artifacts"; artifacts: Artifact[] };

export interface ReportSection {
  questionId: string;
  tier: QuestionTier;
  question: string;
  intent: string;
  /** Always rendered. Present even at figures_only. */
  computed: Block[];
  /** Model-authored, post-resolution. Empty at figures_only. */
  written: Block[];
  /**
   * Why this question has no answer. Rendered in place of content, never
   * silently omitted — a missing section and an unanswerable question look
   * identical to a reader and mean opposite things.
   */
  gap: string | null;
}

/** What was thrown away getting here, so the footer can say so. */
export interface ReportIntegrity {
  claimsDroppedUncited: number;
  claimsDroppedUnresolvable: number;
  claimsDroppedUnconfirmed: number;
  notes: string[];
}

export interface ReportModel {
  meta: {
    projectId: string;
    suiteName: string;
    batchRunId: string;
    /** Passed in, never read from the clock, so the same run renders the same file. */
    generatedAt: string;
  };
  tier: ReportTier;
  headline: {
    passRate: PassRateFact;
    counts: RunOutcomeCounts;
  };
  sections: ReportSection[];
  integrity: ReportIntegrity;
}
