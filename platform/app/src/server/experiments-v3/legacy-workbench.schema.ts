import {
  LEGACY_EXPERIMENT_TASK_TYPES,
  type LegacyExperimentTaskType,
} from "@langwatch/experiment-contract";
import { z } from "zod";
import { checkPreconditionsSchema } from "../evaluations/types";
import { mappingStateSchema } from "../tracer/tracesMapping";

const evaluatorCategories = [
  "expected_answer",
  "llm_judge",
  "quality",
  "rag",
  "safety",
  "custom_evaluators",
] as const;
const steps = ["task", "dataset", "execution", "evaluation", "results"] as const;
const dataSourceTypes = ["choose", "from_production", "manual", "upload"] as const;
const executionMethods = [
  "realtime_on_message",
  "realtime_guardrail",
  "realtime_manually",
  "offline_prompt",
  "offline_http",
  "offline_workflow",
  "offline_notebook",
  "offline_code_execution",
  "api",
] as const;

export const workbenchStateSchema = z.object({
  name: z.string().optional(),
  step: z.enum(steps),
  task: z.enum(Object.keys(LEGACY_EXPERIMENT_TASK_TYPES) as [LegacyExperimentTaskType]).optional(),
  dataSource: z.enum(dataSourceTypes).optional(),
  executionMethod: z.enum(executionMethods).optional(),
  evaluatorCategory: z.enum(evaluatorCategories).optional(),
  realTimeTraceMappings: mappingStateSchema.optional(),
  realTimeExecution: z
    .object({
      sample: z.number().min(0).max(1).optional(),
      preconditions: checkPreconditionsSchema.optional(),
    })
    .optional(),
  workspaceTab: z.enum(["dataset", "workflow", "results", "code-implementation"]).optional(),
  isThreadMapping: z.boolean().optional(),
  realTimeThreadMappings: z
    .object({
      mapping: z.record(
        z.string(),
        z.object({
          source: z.enum(["", "thread_id", "traces", "formatted_traces"]),
          selectedFields: z.array(z.string()).optional(),
        }),
      ),
    })
    .optional(),
});
export type WizardState = z.infer<typeof workbenchStateSchema>;
