/**
 * The collaborators a run's cells reach the rest of the deployment through. Types only, so every
 * layer of a cell can name them.
 */

import type { AgentApi } from "@langwatch/agent-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import type { ExperimentRunAbortRepository } from "../repositories/experiment-run-abort.repository.ts";
import type { ExperimentAttachmentInputService } from "../services/experiment-attachment-input.service.ts";
import type { ExperimentModelCost } from "../services/experiment-run-model-cost.service.ts";
import type { ExperimentSandboxCredential } from "../services/experiment-run-sandbox-key.service.ts";
import type { ExperimentService } from "../services/experiment.service.ts";

/**
 * Everything a cell reaches outside itself, injected as one bag
 * rather than threaded per-signature or read off a process singleton.
 */
export type ExperimentRunCollaborators = {
  /** The studio engine each cell is dispatched to, through the workflow module. */
  studio: Pick<WorkflowApi, "postStudioEvent">;
  /** The deployment's price table, for cells the engine reports untariffed. */
  cost: ExperimentModelCost;
  /** The run's stop signal, which a cell reads. */
  abort: ExperimentRunAbortRepository;
  /** The Eventing command surface a run's results are dispatched through. */
  experiments: ExperimentService;
  /** Where a cell's evaluator result is reported as an evaluation. */
  evaluationReporting: Pick<EvaluationApi, "reportEvaluation">;
  /** The scoped key a run lends to the code it executes. */
  sandboxCredentials: ExperimentSandboxCredential;
  /** One turn to a connected agent, through the runtime a live SDK registered on. */
  connectedDispatch: Pick<AgentApi, "callConnected">;
  /** Reads the row's image and file values into what a target can open. */
  attachments: ExperimentAttachmentInputService;
};
