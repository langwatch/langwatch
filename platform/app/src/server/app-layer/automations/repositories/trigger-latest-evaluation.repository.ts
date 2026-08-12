/**
 * The per-trigger latest-evaluation snapshot: what the alert evaluator
 * observed on its most recent check and what it decided.
 *
 * Exactly one row per trigger — the write is an upsert on the trigger id, so
 * the table is bounded by the number of alerts and never needs pruning. It is
 * a snapshot, not a ledger: the fire history lives in `TriggerSent` and is
 * read through `trigger-fire-history.repository.ts`.
 */

/** Why the evaluator skipped a check without reaching a verdict. Stable
 *  codes, never prose — the UI maps them to customer copy, and an
 *  unrecognised code degrades to a generic explanation. */
export type EvaluationSkipCode =
  /** The alert points at a graph, series, or project that no longer resolves. */
  | "subject_missing"
  /** Threshold, operator, time window, or series is not set on the alert. */
  | "incomplete_configuration"
  /** The graph groups by a field with more distinct values than a threshold
   *  read can carry, so the check cannot be answered as configured. */
  | "result_too_large"
  /** The saved series asks for a percentage of a per-entity measurement,
   *  which the query builder refuses rather than answer wrongly. */
  | "series_percentage_unsupported"
  /** The alert is switched off, so no check was performed. */
  | "inactive";

/** What the evaluator decided. Mirrors the evaluator's own result status; an
 *  unrecognised value must read as a plain "checked" rather than fail. */
export type EvaluationVerdict =
  | "fired"
  | "already_firing"
  | "resolved"
  | "not_breached"
  | "not_delivered"
  | "skipped";

/**
 * One recorded evaluation.
 *
 * Metadata only — an observed number, the condition it was compared against,
 * and a verdict. No trace ids and no trace content: this surface is gated by
 * `triggers:view`, which is weaker than trace-content permission, exactly as
 * the fire ledger is.
 */
export interface TriggerLatestEvaluation {
  triggerId: string;
  projectId: string;
  evaluatedAt: Date;
  verdict: EvaluationVerdict;
  /** The metric value observed, or null when the check was skipped before the
   *  metric could be read. */
  observedValue: number | null;
  threshold: number | null;
  operator: string | null;
  timePeriodMinutes: number | null;
  skipCode: EvaluationSkipCode | null;
}

/** What an evaluation write carries — the whole snapshot, `projectId`
 *  included so the write is tenancy-scoped. */
export type RecordEvaluationInput = TriggerLatestEvaluation;

export interface TriggerLatestEvaluationRepository {
  /** Replace the trigger's snapshot with this evaluation. */
  upsert(input: RecordEvaluationInput): Promise<void>;

  /** The trigger's latest evaluation, or null when it has never been
   *  evaluated (or was never a kind of automation that is evaluated). */
  findByTriggerId(params: {
    projectId: string;
    triggerId: string;
  }): Promise<TriggerLatestEvaluation | null>;
}
