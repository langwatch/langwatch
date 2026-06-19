import { z } from "zod";

import { checkPreconditionsSchema } from "../evaluations/types";
import { mappingStateSchema } from "../tracer/tracesMapping";

/**
 * Persisted "workbench state" for legacy evaluation experiments. The
 * evaluation wizard that produced this state has been removed, but the
 * experiments router still reads and writes this shape so existing
 * experiments keep loading. New experiments use the evaluations-v3 state.
 */

export const EVALUATOR_CATEGORIES = [
  "expected_answer",
  "llm_judge",
  "quality",
  "rag",
  "safety",
  "custom_evaluators",
] as const;

export type EvaluatorCategory = (typeof EVALUATOR_CATEGORIES)[number];

export const STEPS = [
  "task",
  "dataset",
  "execution",
  "evaluation",
  "results",
] as const;

export type Step = (typeof STEPS)[number];

export const TASK_TYPES = {
  real_time: "Real-time evaluation",
  llm_app: "Offline evaluation",
  prompt_creation: "Prompt Creation",
  custom_evaluator: "Evaluate your Evaluator",
  scan: "Scan for Vulnerabilities (Coming Soon)",
} as const;

export type TaskType = keyof typeof TASK_TYPES;

export const DATA_SOURCE_TYPES = {
  choose: "Choose existing dataset",
  from_production: "Import from Production",
  manual: "Create with AI",
  upload: "Upload CSV",
} as const;

export const OFFLINE_EXECUTION_METHODS = {
  offline_prompt: "Create a prompt",
  offline_http: "Call an HTTP endpoint",
  offline_workflow: "Create a Workflow",
  offline_notebook: "Run on Notebook or CI/CD Pipeline",
  offline_code_execution: "Run code",
} as const;

export type OfflineExecutionMethod = keyof typeof OFFLINE_EXECUTION_METHODS;

export const EXECUTION_METHODS = {
  realtime_on_message: "When a message arrives",
  realtime_guardrail: "As a guardrail",
  realtime_manually: "Manually",

  ...OFFLINE_EXECUTION_METHODS,
  api: "Run on Notebook or CI/CD Pipeline",
} as const;

export const workbenchStateSchema = z.object({
  name: z.string().optional(),
  step: z.enum(STEPS),
  task: z.enum(Object.keys(TASK_TYPES) as [keyof typeof TASK_TYPES]).optional(),
  dataSource: z
    .enum(Object.keys(DATA_SOURCE_TYPES) as [keyof typeof DATA_SOURCE_TYPES])
    .optional(),
  executionMethod: z
    .enum(Object.keys(EXECUTION_METHODS) as [keyof typeof EXECUTION_METHODS])
    .optional(),
  evaluatorCategory: z.enum(EVALUATOR_CATEGORIES).optional(),
  realTimeTraceMappings: mappingStateSchema.optional(),
  realTimeExecution: z
    .object({
      sample: z.number().min(0).max(1).optional(),
      preconditions: checkPreconditionsSchema.optional(),
    })
    .optional(),
  workspaceTab: z
    .enum(["dataset", "workflow", "results", "code-implementation"])
    .optional(),
  isThreadMapping: z.boolean().optional(),
  realTimeThreadMappings: z
    .object({
      mapping: z.record(
        z.object({
          source: z.enum(["", "thread_id", "traces", "formatted_traces"]),
          selectedFields: z.array(z.string()).optional(),
        }),
      ),
    })
    .optional(),
});

export type WizardState = z.infer<typeof workbenchStateSchema>;
