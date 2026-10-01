import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentServerConfig } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MembersRead } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import { experimentAttachmentLinkChannels } from "../channels/experiment-attachment-link-channels.registry.ts";
import { experimentRunEventStreamChannels } from "../channels/experiment-run-event-stream-channels.registry.ts";
import type { ExperimentRunEventStream } from "../channels/experiment-run-event-stream.channel.ts";
import { ExecuteExperimentCellCommand } from "../eventing/experiment-run-cell.commands.ts";
import {
  completeRun,
  executeCell,
  failLostCell,
} from "../eventing/experiment-run-execution.intent.ts";
import { createExperimentRunFramesSubscriber } from "../eventing/experiment-run-frames.subscriber.ts";
import { ExperimentRunPlanStore } from "../eventing/experiment-run-plan.store.ts";
import {
  buildExperimentRunProcessingPipeline,
  type ExperimentRunProcessingPipeline,
} from "../eventing/experiment-run-processing.pipeline.ts";
import { ExperimentRunProgressStore } from "../eventing/experiment-run-progress.store.ts";
import type { ExperimentEventingClickHouseResolver } from "../repositories/experiment-clickhouse.repository.ts";
import type { ExperimentIdLookupRepository } from "../repositories/experiment-id-lookup.repository.ts";
import type { ExperimentRunAbortRepository } from "../repositories/experiment-run-abort.repository.ts";
import type { ExperimentRunFoldRepository } from "../repositories/experiment-run-fold.repository.ts";
import { experimentRunRepositories } from "../repositories/experiment-run-repositories.registry.ts";
import {
  runRefusalsOf,
  type ExperimentRunRefusals,
} from "../rules/experiment-run-availability.rules.ts";
import { ExperimentAttachmentInputService } from "./experiment-attachment-input.service.ts";
import type { ExecutionDataServices } from "./experiment-execution-data.service.ts";
import { ExperimentRunBoardWriteBackService } from "./experiment-run-board-write-back.service.ts";
import { ExperimentRunCellService } from "./experiment-run-cell.service.ts";
import type { ExperimentRunCommandDispatcherService } from "./experiment-run-command-dispatcher.service.ts";
import { ExperimentRunModelCostService } from "./experiment-run-model-cost.service.ts";
import { ExperimentRunSandboxCredentialService } from "./experiment-run-sandbox-credential.service.ts";
import { WorkflowEvaluationService } from "./experiment-workflow-evaluation.service.ts";
import { ExperimentWorkflowSourceService } from "./experiment-workflow-source.service.ts";
import type { ExperimentService } from "./experiment.service.ts";

/** `experiment_run_processing`, its senders and run lookup. */
export type ExperimentRunProcessing = Readonly<{
  pipeline: ExperimentRunProcessingPipeline;
  commands: ExperimentRunCommandDispatcherService;
  idLookup: ExperimentIdLookupRepository;
  /** The channel a run's frames reach the process streaming it on. */
  stream: ExperimentRunEventStream;
  /** The run's progress fold, which a poll and an abort read by runId. */
  folds: ExperimentRunFoldRepository;
  /** The run's stop signal, set on abort. */
  abort: ExperimentRunAbortRepository;
  /** This deployment's public origin, for the link a polled run answers with. */
  publicBaseUrl: string | undefined;
  /** The peers a run's execution data is loaded through before it is planned. */
  services: ExecutionDataServices;
  /** Refuses a run against someone else's personal development agent before it starts. */
  ownership: Pick<SuiteApi, "assertConnectedAgentsRunnable">;
  /** Cells in flight at once when a run names no limit of its own. */
  concurrency: number;
  /** What this process refuses of a run, for want of Redis or a public address. */
  refusals: ExperimentRunRefusals;
}>;

type ExperimentRunMembers = MembersRead<readonly ["redis", "logger"]> &
  Readonly<{ publicBaseUrl: string | undefined; processName: string; isSaas: boolean }>;

type ExperimentRunPeers = Readonly<{
  workflows: WorkflowApi;
  dataset: DatasetApi;
  agents: AgentApi;
  evaluators: EvaluatorApi;
  prompts: PromptApi;
  projects: ProjectApi;
  entitlement: EntitlementApi;
  retention: DataRetentionApi;
  modelProviders: ModelProviderApi;
  evaluation: EvaluationApi;
  apiKeys: ApiKeyApi;
  suite: SuiteApi;
  storedObjects: StoredObjectApi;
}>;

type ExperimentRunDeps = Readonly<{
  commands: ExperimentRunCommandDispatcherService;
  experiments: ExperimentService;
  resolveClient: ExperimentEventingClickHouseResolver;
  members: ExperimentRunMembers;
  peers: ExperimentRunPeers;
  config: Pick<
    ExperimentServerConfig,
    "blockLocalHttpCalls" | "allowedProxyHosts" | "runConcurrency"
  >;
}>;

/** The run machinery: folds, stop signal, frames, cells, board write-back and the run pipeline. */
export class ExperimentRunService {
  static create(deps: ExperimentRunDeps): ExperimentRunService {
    const { commands, experiments, resolveClient, members, peers, config } = deps;
    const { redis, logger, publicBaseUrl, processName } = members;
    const { retention } = peers;
    const defaultRetentionDays = () => retention.getPlatformDefaultRetentionDays();
    const repositories = redis
      ? experimentRunRepositories.shared.create({ redis, resolveClient, defaultRetentionDays })
      : experimentRunRepositories.local.create({ resolveClient, defaultRetentionDays });
    const { folds, abort } = repositories;
    const stream = redis
      ? experimentRunEventStreamChannels.live.create({ redis })
      : experimentRunEventStreamChannels.memory.create();
    const refusals = runRefusalsOf({
      sharedStore: redis !== undefined,
      publicBaseUrl,
      processName,
    });
    if (refusals.start) {
      logger.warn(
        { capability: refusals.start.capability },
        "experiment runs are refused in this process",
      );
    }
    const services: ExecutionDataServices = {
      datasets: peers.dataset,
      prompts: peers.prompts,
      agents: peers.agents,
      evaluators: peers.evaluators,
      workflows: ExperimentWorkflowSourceService.create(peers.workflows),
      entitlements: peers.entitlement,
      projects: peers.projects,
    };
    const cost = ExperimentRunModelCostService.create({ modelProviders: peers.modelProviders });
    const cells = ExperimentRunCellService.create({
      folds,
      stream,
      services,
      workflows: peers.workflows,
      collaborators: {
        studio: peers.workflows,
        cost,
        abort,
        experiments,
        evaluationReporting: peers.evaluation,
        sandboxCredentials: ExperimentRunSandboxCredentialService.create({
          projects: peers.projects,
          apiKeys: peers.apiKeys,
        }),
        connectedDispatch: peers.agents,
        attachments: ExperimentAttachmentInputService.create({
          storedObjects: peers.storedObjects,
          links: experimentAttachmentLinkChannels.http.create({
            policy: {
              blockLocal: config.blockLocalHttpCalls,
              allowedHosts: config.allowedProxyHosts,
              verifyTls: members.isSaas,
            },
          }),
        }),
      },
    });
    const workflowEvaluations = WorkflowEvaluationService.create({
      experiments,
      workflowSource: services.workflows,
      services,
      concurrency: config.runConcurrency,
      folds,
      refusals,
      requests: commands,
      baseUrl: publicBaseUrl,
    });
    const boardWriteBack = ExperimentRunBoardWriteBackService.create({
      folds,
      experiments: experiments.workbench,
    });

    return new ExperimentRunService({
      cost,
      workflowEvaluations,
      processing: {
        pipeline: buildExperimentRunProcessingPipeline({
          experimentRunStateFoldStore: repositories.experimentRunStateFoldStore,
          experimentRunItemAppendStore: repositories.experimentRunItemAppendStore,
          workflowEvaluations,
          experimentRunPlanFoldStore: ExperimentRunPlanStore.create({ repository: folds }),
          experimentRunProgressFoldStore: ExperimentRunProgressStore.create({ repository: folds }),
          executeCell: ExecuteExperimentCellCommand.create({ cells }),
          runExecution: {
            executeCell: executeCell(commands),
            failCell: failLostCell(commands),
            complete: completeRun({ commands, boardWriteBack }),
          },
          runFrames: createExperimentRunFramesSubscriber({ stream }),
          retention: {
            resolve: (tenantId) => retention.getResolvedForProject({ projectId: tenantId }),
          },
        }),
        commands,
        idLookup: repositories.idLookup,
        stream,
        folds,
        abort,
        publicBaseUrl,
        services,
        ownership: peers.suite,
        concurrency: config.runConcurrency,
        refusals,
      },
    });
  }

  /** Starts a workflow's evaluation here and runs it where the pipeline is drained. */
  readonly workflowEvaluations: WorkflowEvaluationService;
  readonly processing: ExperimentRunProcessing;
  /** The project's own model cost rules, as the pricing cascade reads them. */
  readonly cost: ExperimentRunModelCostService;

  private constructor(parts: {
    cost: ExperimentRunModelCostService;
    workflowEvaluations: WorkflowEvaluationService;
    processing: ExperimentRunProcessing;
  }) {
    this.cost = parts.cost;
    this.workflowEvaluations = parts.workflowEvaluations;
    this.processing = parts.processing;
  }
}
