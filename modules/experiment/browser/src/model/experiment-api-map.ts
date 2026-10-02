/**
 * The procedures this package calls, derived from each owner's contract.
 * Segment names are the React Query cache key, so they stay the owners'.
 */

import type { agentTrpc } from "@langwatch/agent-contract";
import type { ContractApiMap, OutputsFromMap, RouterFromMap } from "@langwatch/api/web";
import type { batchRecordTrpc, datasetRecordTrpc, datasetTrpc } from "@langwatch/dataset-contract";
import type { evaluationTrpc } from "@langwatch/evaluation-contract";
import type { evaluatorTrpc } from "@langwatch/evaluator-contract";
import type { experimentsTrpc } from "@langwatch/experiment-contract";
import type { opsDashboardTrpc } from "@langwatch/ops-contract";
import type { promptTrpc } from "@langwatch/prompt-contract";

export type ExperimentApiMap = ContractApiMap<typeof experimentsTrpc> &
  ContractApiMap<typeof agentTrpc> &
  ContractApiMap<typeof promptTrpc> &
  ContractApiMap<typeof evaluatorTrpc> &
  ContractApiMap<typeof evaluationTrpc> &
  ContractApiMap<typeof datasetTrpc> &
  ContractApiMap<typeof datasetRecordTrpc> &
  ContractApiMap<typeof batchRecordTrpc> &
  ContractApiMap<typeof opsDashboardTrpc>;

/** The slice of the root router this package calls. */
export type ExperimentApiRouter = RouterFromMap<ExperimentApiMap>;

/** What each procedure answers, as the browser receives it. */
export type ExperimentApiOutputs = OutputsFromMap<ExperimentApiMap>;

/** One experiment row, as the browser receives it. */
export type ExperimentRow = ExperimentApiOutputs["experiments"]["getExperimentBySlugOrId"];
