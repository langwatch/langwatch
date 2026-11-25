/** The hooks Workflow's own contract generates, and what each procedure takes and answers. */

import {
  type ContractApiMap,
  createModuleApi,
  type ModuleApi,
  type OutputsFromMap,
} from "@langwatch/api/web";
import type { workflowOptimizationTrpc, workflowTrpc } from "@langwatch/workflow-contract";

type WorkflowApiMap = ContractApiMap<typeof workflowOptimizationTrpc> &
  ContractApiMap<typeof workflowTrpc>;

export const workflowClient: ModuleApi<WorkflowApiMap> = createModuleApi<WorkflowApiMap>();

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

/** What each procedure takes, as the browser sends it. */
export type WorkflowInputs = { [K in keyof WorkflowApiMap]: InputsOf<WorkflowApiMap[K]> };

/** What each procedure answers, as the browser receives it. */
export type WorkflowOutputs = OutputsFromMap<WorkflowApiMap>;
