import { featureApi } from "@langwatch/runtime-composition";
import type { EvaluatorCreateInput, EvaluatorUpdateInput } from "./evaluator.service.ts";
import type { Evaluator } from "./evaluator.ts";
/** Callable evaluator operations shared by process peers after composition. */
export interface EvaluatorApi {
  getAll(input: { projectId: string }): Promise<Evaluator[]>;
  listByWorkflow(input: { workflowId: string; projectId: string }): Promise<Evaluator[]>;
  create(input: EvaluatorCreateInput): Promise<Evaluator>;
  update(input: EvaluatorUpdateInput): Promise<Evaluator>;
  archive(input: { id: string; projectId: string }): Promise<Evaluator>;
}

export const EvaluatorApi = featureApi<EvaluatorApi>("evaluator");
