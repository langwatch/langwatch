import { defineServerModule } from "@langwatch/kernel";

import { EvaluationApp } from "./app/evaluation.app.ts";
import type {
  EvaluationAzureSafetyCredentials,
  EvaluationCostRecorder,
  EvaluationExecution,
  EvaluationExecutionIntent,
  EvaluationInputStorage,
  EvaluationInputsOffload,
  EvaluationRetentionFloor,
  EvaluationSettingsRecovery,
  ExecuteEvaluationCommandDeps,
} from "./app/evaluation.members.ts";
import { evaluationProcessingEventing } from "./eventing/evaluation-processing.pipeline.ts";
import { ClickhouseMonitorPerformanceRepository } from "./repositories/clickhouse/clickhouse.monitor-performance.repository.ts";
import type { EvaluationClickHouseResolver } from "./repositories/clickhouse/evaluation-clickhouse-client.ts";
import { ClickHouseEvaluationRepository } from "./repositories/clickhouse/evaluation.repository.ts";
import { evaluationRepositories } from "./repositories/evaluation-repositories.registry.ts";
import { PrismaEvaluationCostRepository } from "./repositories/prisma/prisma.evaluation-cost.repository.ts";
import { DirectEvaluationExecutionReceiptService } from "./services/direct.evaluation-execution-receipt.service.ts";
import { EvaluationCostService } from "./services/evaluation-cost.service.ts";
import { EvaluationExecutionIntentService } from "./services/evaluation-execution-intent.service.ts";
import {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
} from "./services/evaluation-execution.service.ts";
import {
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  EvaluationInputsOffloadService,
  type EvaluationInputOffloadConfig,
} from "./services/evaluation-inputs-offload.service.ts";
import { EvaluationNameAutoslugService } from "./services/evaluation-name-autoslug.service.ts";
import { evaluationTrpcTransport } from "./transport/evaluation.trpc.ts";
import { evaluationsLegacyRest } from "./transport/evaluations-legacy.rest.ts";

export {
  createUnavailableEvaluationInfrastructure,
  type EvaluationInfrastructure,
} from "./app/evaluation.app.ts";

export const evaluationServer = defineServerModule("evaluation")
  .withRepositories(evaluationRepositories)
  .withApp(EvaluationApp)
  .withTransports(evaluationTrpcTransport, evaluationsLegacyRest)
  .withEventing(evaluationProcessingEventing);

// Evaluation's composition seam: a process builds this feature's runtime through the factories
// below and never names one of its repositories or services. What a composition root passes is
// only the substrates a deployment owns — its ClickHouse resolver, its retention floor, its
// object store, its connection.
/** The `evaluation_runs` read, for a process that needs one read and no service around it. */
export type EvaluationRunReads = ClickHouseEvaluationRepository;

/** The monitors page's seven-day trend, for a process that reads it and executes nothing. */
export type MonitorPerformanceReads = ClickhouseMonitorPerformanceRepository;

/** Evaluation's evaluator engine, once its collaborators are composed. */
export type EvaluationEngine = EvaluationExecutionService;

/** The cost ledger an evaluation run writes into. */
export type EvaluationCostLedger = EvaluationCostService;

/** The offload/read service Evaluation's projection and its API share. */
export type EvaluationInputsOffloadStore = EvaluationInputsOffloadService;

/** The tenant-routed ClickHouse the run repositories read and write on. */
export type EvaluationClickHouseAccess = Readonly<{
  resolveClient: EvaluationClickHouseResolver;
  /** The day a run read will not look below — the deployment's own retention default. */
  retentionFloor: EvaluationRetentionFloor;
}>;

/** Reads `evaluation_runs` directly, with no execution capability composed. */
export function createEvaluationRunReads(access: EvaluationClickHouseAccess): EvaluationRunReads {
  return ClickHouseEvaluationRepository.create({
    resolveClient: access.resolveClient,
  });
}

/** Reads the monitor performance trend, with no execution capability composed. */
export function createMonitorPerformanceReads(input: {
  resolveClickHouse: EvaluationClickHouseResolver;
}): MonitorPerformanceReads {
  return ClickhouseMonitorPerformanceRepository.create({
    resolveClickHouse: input.resolveClickHouse,
  });
}

/** The ONLINE engine: a stored trace rendered through its mappings and evaluated. */
export function createEvaluationEngine(deps: EvaluationExecutionDeps): EvaluationEngine {
  return EvaluationExecutionService.create(deps);
}

/**
 * The intent a queued evaluation command is executed through, over the engine the process
 * composed. The receipt ledger is built here: a second one would bill a run twice.
 */
export function createEvaluationExecutionIntent(input: {
  monitors: ExecuteEvaluationCommandDeps["monitors"];
  traces: ExecuteEvaluationCommandDeps["traces"];
  azureSafetyCredentials: EvaluationAzureSafetyCredentials;
  settingsRecovery: EvaluationSettingsRecovery;
  inputsOffload: EvaluationInputsOffload;
  /** The engine the receipt drives, adapted by the process to the command shape. */
  execution: EvaluationExecution;
  /** Where the run is billed. */
  costs: EvaluationCostRecorder;
}): EvaluationExecutionIntent {
  return EvaluationExecutionIntentService.create({
    monitors: input.monitors,
    traces: input.traces,
    azureSafetyCredentials: input.azureSafetyCredentials,
    settingsRecovery: input.settingsRecovery,
    inputsOffload: input.inputsOffload,
    executionReceipt: DirectEvaluationExecutionReceiptService.create({
      execution: input.execution,
      costs: input.costs,
    }),
  });
}

/**
 * The offload store for evaluation inputs. The three size limits default to the module's own:
 * two processes disagreeing on the ceiling would write markers the reader cannot resolve.
 */
export function createEvaluationInputsOffload(input: {
  storage: EvaluationInputStorage;
  config?: EvaluationInputOffloadConfig;
}): EvaluationInputsOffloadStore {
  return EvaluationInputsOffloadService.create({
    storage: input.storage,
    config: input.config ?? {
      inlineMaxBytes: EVAL_INPUTS_INLINE_MAX_BYTES,
      hardCeilingBytes: EVAL_INPUTS_HARD_CEILING_BYTES,
      previewBytes: EVAL_INPUTS_PREVIEW_BYTES,
    },
  });
}

/** The cost ledger, over the deployment's own Prisma connection. */
export function createEvaluationCostLedger(input: {
  database: Parameters<typeof PrismaEvaluationCostRepository.create>[0]["prisma"];
}): EvaluationCostLedger {
  return EvaluationCostService.create({
    repository: PrismaEvaluationCostRepository.create({ prisma: input.database }),
  });
}

/**
 * Evaluation's own slug derivation. The id it produces is the row key an SDK-reported evaluation
 * is upserted under, so a second spelling would file one evaluator's results under two.
 */
export function deriveEvaluationEvaluatorId(name: string): string {
  return EvaluationNameAutoslugService.create().derive(name);
}
