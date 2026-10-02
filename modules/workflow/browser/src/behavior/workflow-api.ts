/**
 * The procedures the workflow screens call, each derived from its owner's
 * contract (§3.4). Segment names are the React Query cache key.
 */

import type { agentTrpc, httpProxyTrpc } from "@langwatch/agent-contract";
import {
  createModuleApi,
  type ContractApiMap,
  type OutputsFromMap,
  type RouterFromMap,
} from "@langwatch/api/web";
import type { datasetRecordTrpc } from "@langwatch/dataset-contract";
import type { evaluatorTrpc } from "@langwatch/evaluator-contract";
import type { experimentsTrpc } from "@langwatch/experiment-contract";
import type { featureFlagTrpc } from "@langwatch/feature-flag-contract";
import type { modelProviderTrpc } from "@langwatch/model-provider-contract";
import type { projectTrpc } from "@langwatch/project-contract";
import type { secretTrpc } from "@langwatch/secret-contract";
import type { workflowOptimizationTrpc, workflowTrpc } from "@langwatch/workflow-contract";

export type WorkflowApiMap = ContractApiMap<typeof workflowTrpc> &
  ContractApiMap<typeof workflowOptimizationTrpc> &
  ContractApiMap<typeof agentTrpc> &
  ContractApiMap<typeof httpProxyTrpc> &
  ContractApiMap<typeof datasetRecordTrpc> &
  ContractApiMap<typeof evaluatorTrpc> &
  ContractApiMap<typeof experimentsTrpc> &
  ContractApiMap<typeof featureFlagTrpc> &
  ContractApiMap<typeof modelProviderTrpc> &
  ContractApiMap<typeof projectTrpc> &
  ContractApiMap<typeof secretTrpc>;

export const workflowApi = createModuleApi<WorkflowApiMap>();

export type WorkflowApiRouter = RouterFromMap<WorkflowApiMap>;

export type RouterOutputs = OutputsFromMap<WorkflowApiMap>;

/** A listed workflow, as the wire carries it. */
export type WorkflowListRow = RouterOutputs["workflow"]["getAll"][number];
