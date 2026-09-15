/**
 * What the public evaluation doors reach the Evaluation capability with. The
 * wire schemas those doors publish stay beside their declaration; these are the
 * shapes the operations themselves take.
 */
import type { EvaluatorTypes } from "@langwatch/evaluator-contract";
import type { ESBatchEvaluationRESTParams } from "@langwatch/experiment-contract";

/**
 * What the evaluator runtime is handed. Two arms: a built-in evaluator takes
 * the six canonical fields, a custom or code evaluator whatever it declares.
 */
export type EvaluationDispatchData =
  | Readonly<{ type: "default"; data: Record<string, string | number | undefined | null> }>
  | Readonly<{ type: "custom"; data: Record<string, unknown> }>;

/** One saved or configured monitor, as the evaluate doors read it. */
export type EvaluationMonitorSummary = Readonly<{
  id: string;
  name: string;
  checkType: string;
  parameters: unknown;
  enabled: boolean;
}>;

/** One saved evaluator, resolved for a run of it. */
export type SavedEvaluatorResolution = Readonly<{
  checkType: string;
  settings: Record<string, unknown>;
  name: string;
  evaluatorId: string;
  requiredFields?: string[] | undefined;
}>;

/** One row addressed by the slug it carries inside a project. */
export type EvaluationSlugLookup = Readonly<{ projectId: string; slug: string }>;

/** A row a slug resolved to, where only its identity is read. */
export type EvaluationSlugMatch = Readonly<{ id: string }>;

/** Running one evaluator over one input. */
export type RunEvaluatorInput = Readonly<{
  projectId: string;
  evaluatorType: EvaluatorTypes;
  data: EvaluationDispatchData;
  settings: Record<string, unknown>;
}>;

/** Which model the project's cascade resolves for one feature key. */
export type EvaluationModelLookup = Readonly<{ projectId: string; featureKey: string }>;

/** One saved evaluator, addressed by either of the two names it answers to. */
export type SavedEvaluatorLookup = Readonly<{ projectId: string; idOrSlug: string }>;

/** What running an evaluator cost, as the ledger records it. */
export type EvaluationCostRecord = Readonly<{
  id: string;
  projectId: string;
  costType: "GUARDRAIL" | "TRACE_CHECK" | "BATCH_EVALUATION";
  costName: string;
  referenceType: "CHECK" | "BATCH";
  referenceId: string;
  amount: number;
  currency: string;
  extraInfo?: Record<string, unknown> | undefined;
}>;

/** One row of a dataset evaluation, as `POST /api/dataset/evaluate` writes it. */
export type DatasetEvaluationRow = Readonly<{
  id: string;
  experimentId: string;
  projectId: string;
  data: Record<string, unknown>;
  status: string;
  score: number;
  passed: boolean;
  label: string | null;
  details: string;
  cost: number;
  evaluation: string;
  datasetSlug: string;
  datasetId: string;
}>;

/** What the SDK's batch result log reports, for one project. */
export type LogBatchEvaluationInput = Readonly<{
  projectId: string;
  params: ESBatchEvaluationRESTParams;
}>;
