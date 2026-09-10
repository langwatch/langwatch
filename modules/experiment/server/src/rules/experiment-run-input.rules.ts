/**
 * What a run is asked for: the ports it reaches the rest of the deployment through, the state and
 * loaded targets it evaluates, and the shape one connected-agent turn is dispatched in. Types only,
 * so every layer of the run can name them without reaching for the orchestrator itself.
 */

import type { WorkflowService } from "@langwatch/workflow-server";
import type {
  CarriedOverCell,
  EvaluationsV3State,
  ExecutionCell,
  ExecutionScope,
} from "@langwatch/experiment-contract";
import type { ExperimentService } from "../services/experiment.service.ts";

import type {
  Agent as TypedAgent,
  CallOutcome,
  DispatchAgent,
  DispatchCall,
} from "@langwatch/agent-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import type { RunActor } from "@langwatch/scenario-contract";
import type { ExperimentEvaluationReporting } from "../ports/experiment-evaluation-reporting.port.ts";
import type { ExperimentModelCost } from "../ports/experiment-model-cost.port.ts";
import type { ExperimentRunAbortRepository } from "../repositories/experiment-run-abort.repository.ts";
import type { ExperimentSandboxCredential } from "../ports/experiment-sandbox-credential.port.ts";
import type { ExperimentConnectedDispatch } from "../ports/experiment-connected-dispatch.port.ts";
import type { ExperimentConnectedAgentOwnership } from "../ports/experiment-connected-agent-ownership.port.ts";
import type { ExperimentStudioDispatch } from "../ports/experiment-studio-dispatch.port.ts";
import type { ResultMapperConfig } from "../processes/experiment-result-mapping.process.ts";
import type { LoadedWorkflow } from "../services/experiment-execution-data.service.ts";

/**
 * Everything the run loop reaches outside itself, injected as one bag
 * rather than threaded per-signature or read off a process singleton.
 */
export type ExperimentRunPorts = {
  /** The studio engine each cell is dispatched to. */
  studio: ExperimentStudioDispatch;
  /** The deployment's price table, for cells the engine reports untariffed. */
  cost: ExperimentModelCost;
  /** The stop signal and the owner record this run's abort is authorized against. */
  abort: ExperimentRunAbortRepository;
  /** The Eventing command surface a run's results are dispatched through. */
  experiments: ExperimentService;
  /** Where a cell's evaluator result is reported as an evaluation. */
  evaluationReporting: ExperimentEvaluationReporting;
  /** The scoped key a run lends to the code it executes. */
  sandboxCredentials: ExperimentSandboxCredential;
  /** One turn to a connected agent, through the runtime a live SDK registered on. */
  connectedDispatch: ExperimentConnectedDispatch;
  /** Refuses a run against someone else's personal development agent. */
  connectedAgentOwnership: ExperimentConnectedAgentOwnership;
};

/**
 * Input data required to run the orchestrator.
 */
export type OrchestratorInput = {
  projectId: string;
  experimentId?: string; // For ES storage
  workflowVersionId?: string; // For ES storage
  scope: ExecutionScope;
  state: EvaluationsV3State;
  datasetRows: Array<Record<string, unknown>>;
  datasetColumns: Array<{ id: string; name: string; type: string }>;
  loadedPrompts: Map<string, VersionedPrompt>;
  loadedAgents: Map<string, TypedAgent>;
  ports: ExperimentRunPorts;
  workflows: WorkflowService;
  /** Evaluators loaded from DB - settings and names are fetched fresh from here */
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  /** Studio workflows loaded for workflow targets (committed DSL run per row) */
  loadedWorkflows?: Map<string, LoadedWorkflow>;
  /** Optional run ID - if not provided, a human-readable ID will be generated */
  runId?: string;
  /** Process-configured default used when the request does not choose a limit. */
  defaultConcurrency: number;
  /** Request-specific concurrency limit. */
  concurrency?: number;
  /**
   * Pre-existing target outputs keyed by `${rowIndex}:${targetId}`. Phase 2
   * pairwise reads from these when the user re-runs only the pairwise
   * column on top of variants that already produced output in a prior run.
   */
  seedTargetOutputs?: Record<string, { output: unknown; cost?: number; duration?: number }>;
  /**
   * Board cells the run carries rather than produces, so the run holds the
   * whole board and not only the column that was clicked.
   */
  carriedOverCells?: CarriedOverCell[];
  /**
   * Who started the run, when a person did. A personal development agent
   * belongs to the person whose key registered it; a run naming no person
   * is refused the same way a simulation is.
   */
  actor?: RunActor;
};

/** One turn to a connected agent, as the cell executor asks for it. */
export type ConnectedDispatch = (params: {
  projectId: string;
  agent: DispatchAgent;
  call: DispatchCall;
  signal: AbortSignal;
}) => Promise<CallOutcome>;

/** What one connected agent cell needs to run. */
export interface ConnectedCellInput {
  cell: ExecutionCell;
  projectId: string;
  agent: TypedAgent;
  datasetColumns?: Array<{ id: string; name: string; type: string }>;
  loadedEvaluators?: Map<string, { id: string; name: string; config: unknown }>;
  resultMapperConfig?: ResultMapperConfig;
  isAborted?: () => Promise<boolean>;
  /** The dispatcher the turn goes through, replaceable in tests. */
  dispatch?: ConnectedDispatch;
  /** The wait between busy retries, replaceable in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** The clock the retry budget reads, replaceable in tests. */
  now?: () => number;
  ports: ExperimentRunPorts;
  workflows: WorkflowService;
}
