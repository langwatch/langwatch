import { z } from "zod";

const retentionCategorySchema = z.number().int().min(30).nullable();

export const retentionPolicySchema = z.object({
  traces: retentionCategorySchema,
  scenarios: retentionCategorySchema,
  experiments: retentionCategorySchema,
});

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export type RetentionCategory = keyof RetentionPolicy;

export const RETENTION_CATEGORIES = [
  "traces",
  "scenarios",
  "experiments",
] as const satisfies readonly RetentionCategory[];

export const RETENTION_TABLE_CATEGORY_MAP: Record<string, RetentionCategory> = {
  event_log: "traces",
  stored_spans: "traces",
  stored_log_records: "traces",
  stored_metric_records: "traces",
  trace_summaries: "traces",
  evaluation_runs: "traces",
  dspy_steps: "traces",
  simulation_runs: "scenarios",
  suite_runs: "scenarios",
  experiment_runs: "experiments",
  experiment_run_items: "experiments",
};

export const RETENTION_MANAGED_TABLES = Object.keys(
  RETENTION_TABLE_CATEGORY_MAP
);
