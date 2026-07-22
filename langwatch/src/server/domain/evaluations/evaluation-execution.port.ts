import type { MappingState } from "~/server/tracer/tracesMapping";

import type { EvaluationExecutionResult } from "./evaluation-execution.types";

/**
 * Runs one evaluator against a trace. The evaluation command calls this and
 * must not import `app-layer` (ADR-063); `EvaluationExecutionService` satisfies
 * it structurally.
 */
export interface EvaluationExecutionPort {
  executeForTrace(params: {
    projectId: string;
    traceId: string;
    evaluatorType: string;
    settings: Record<string, unknown> | string | number | boolean | null;
    mappings: MappingState | null;
    level?: "trace" | "thread";
    workflowId?: string | null;
  }): Promise<EvaluationExecutionResult>;
}
