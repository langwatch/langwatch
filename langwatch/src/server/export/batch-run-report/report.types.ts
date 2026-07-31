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
  /**
   * Whether Langy writes the analysis, or the report is figures only.
   *
   * Defaults to true so an existing caller keeps the whole document. The
   * difference is not a detail: computing everything else takes under a
   * millisecond and Langy's two passes take a minute or two, so this is the
   * only thing standing between an instant report and a long wait — and the
   * computed half is a complete document on its own, which is why declining is
   * offered rather than merely tolerated as a degraded tier.
   */
  withAnalysis: z.boolean().default(true),
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

/**
 * The stages a report actually passes through, in order.
 *
 * Reported as they happen rather than estimated: the two model passes take tens
 * of seconds each and everything else takes under a millisecond, so a
 * percentage would be a fiction and a spinner says nothing about which of the
 * two long waits a reader is in.
 *
 * Declared here rather than beside the service because the run-history rows
 * render these labels. Importing them from the service pulled the model
 * resolution graph into the browser bundle and took the whole Simulations page
 * down with "attempted to access a server-side environment variable on the
 * client". This module is types and zod only, so it crosses that line safely.
 */
export const REPORT_STAGES = [
  "reading",
  "measuring",
  "writing",
  "checking",
  "rendering",
] as const;
export type ReportStage = (typeof REPORT_STAGES)[number];

/** What each stage is called on screen. */
export const REPORT_STAGE_LABELS: Readonly<Record<ReportStage, string>> = {
  reading: "Reading the run",
  measuring: "Working out what happened",
  writing: "Langy is writing the analysis",
  checking: "Langy is checking it against the run",
  rendering: "Putting the report together",
};

export type ReportProgress = (stage: ReportStage) => void;

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
  /**
   * The grouping fingerprint: ids, numbers and quoted values replaced, so two
   * errors that differ only in their particulars land in the same group. Good
   * for identity, useless to read — a JSON error normalises to nothing but its
   * own punctuation.
   */
  errorShape: string | null;
  /**
   * One of the group's errors as it was actually reported, for a reader.
   *
   * Every run in a group shares a fingerprint, so any one of them describes the
   * group; the first is taken. This is shown instead of {@link errorShape},
   * which is why the aggressive normalisation above costs nothing.
   */
  errorExample: string | null;
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
  /**
   * Why the rate cannot carry a conclusion, when it cannot.
   *
   * A rate is unquotable for two unrelated reasons, and they call for opposite
   * reactions: too few runs is fixed by running more, while a spread too wide
   * over plenty of runs means the agent is genuinely inconsistent. Saying "too
   * few runs" about twenty-one of them is both wrong and the wrong advice.
   */
  inconclusiveReason:
    | "no_settled_runs"
    | "too_few_runs"
    | "spread_too_wide"
    | null;
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

/**
 * One bounded, exemplar conversation — the same replay a reader gets, not just
 * what the model was given.
 *
 * Deterministic and model-free: `transcript-budget.ts` selects which runs
 * qualify, but the turns themselves are read verbatim from the run record. A
 * reader can therefore see this even at the `figures_only` tier.
 */
export interface SelectedTranscript {
  runId: string;
  signatureId: string;
  scenarioName: string;
  turns: { index: number; role: string; content: string }[];
  omittedTurns: number;
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
  /**
   * The same bounded exemplars {@link TruncationFact} counts, kept verbatim so
   * the deterministic layer can render them next to the failure group they
   * belong to. Populated after `buildEvidence()` returns, once transcript
   * selection has run — empty here, same as `truncation`'s counts.
   */
  transcripts: SelectedTranscript[];
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
        /** Exemplar conversations for this failure group, if any were kept. */
        transcripts?: SelectedTranscript[];
      }[];
    }
  /** Pass rate across the runs leading up to this one, current run last. */
  | { kind: "trend"; points: { label: string; value: number }[] }
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

/**
 * The run in the terms someone who did not run it would ask about.
 *
 * Computed, so it survives at every tier. Deliberately free of run ids: this is
 * read by people for whom an identifier answers nothing.
 */
export interface RunSummary {
  /** One sentence, no jargon, safe to quote on its own. */
  verdict: string;
  tone: Tone;
  /** How this compares with the run before it, when there was one. */
  movement: string | null;
  /** Scale and price of the run: scenarios, wall clock, spend. */
  facts: { label: string; value: string }[];
  /** The single thing most worth fixing. */
  topProblem: string | null;
  /** Why the headline figure may not mean what it appears to. */
  caveat: string | null;
}

export interface ReportModel {
  meta: {
    projectId: string;
    suiteName: string;
    batchRunId: string;
    /** Passed in, never read from the clock, so the same run renders the same file. */
    generatedAt: string;
    /**
     * Whether Langy was asked for an analysis at all.
     *
     * A figures-only report has two very different causes — nobody asked, or
     * she was asked and could not — and telling a reader the wrong one either
     * invents a failure or hides one.
     */
    withAnalysis: boolean;
  };
  tier: ReportTier;
  summary: RunSummary;
  headline: {
    passRate: PassRateFact;
    counts: RunOutcomeCounts;
  };
  sections: ReportSection[];
  integrity: ReportIntegrity;
}
