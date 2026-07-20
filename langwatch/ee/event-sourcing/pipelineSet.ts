import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";

import { createIngestionPullProcessingPipeline } from "@ee/event-sourcing/pipelines/ingestion-pull-processing";
import { reconcileIngestionPullProcesses } from "@ee/governance/services/pullers/ingestionPullLifecycle";
import {
  createIngestionPullIntentHandlers,
  createIngestionPullProcessSubscriber,
  INGESTION_PULL_CONCURRENCY,
  INGESTION_PULL_LEASE_DURATION_MS,
  INGESTION_PULL_MAX_ATTEMPTS,
  INGESTION_PULL_PROCESS_NAME,
  ingestionPullProcessDefinition,
  type IngestionPullRunPort,
} from "@ee/governance/services/pullers/process-manager";
import { runIngestionPull } from "@ee/governance/services/pullers/pullerWorker";
import { PrismaIngestionPullRunProjectionRepository } from "@ee/governance/services/pullers/repositories/ingestion-pull-run-projection.prisma.repository";
import { Deferred } from "~/server/event-sourcing/deferred";
import type { EventSourcing } from "~/server/event-sourcing/eventSourcing";
import { mapCommands } from "~/server/event-sourcing/mapCommands";
import {
  OutboxDispatcherService,
  ProcessManagerService,
  ProcessOutboxWorker,
  type ProcessStore,
} from "~/server/event-sourcing/process-manager";

const logger = createLogger("langwatch:enterprise:event-sourcing");

/** Enterprise-owned pipeline dependencies supplied by the app composition root. */
export interface EnterprisePipelineSetConfig {
  prisma: PrismaClient;
  runsWorkers: boolean;
}

type EnterprisePipelineRuntimeDeps = EnterprisePipelineSetConfig & {
  eventSourcing: EventSourcing;
  processStore: ProcessStore;
};

function registerIngestionPullPipeline(deps: EnterprisePipelineRuntimeDeps) {
  const processManager = new ProcessManagerService({
    definition: ingestionPullProcessDefinition,
    store: deps.processStore,
  });
  const recordCompleted = new Deferred<
    (args: Record<string, unknown>) => Promise<void>
  >("ingestionPullRecordCompleted");
  const recordFailed = new Deferred<
    (args: Record<string, unknown>) => Promise<void>
  >("ingestionPullRecordFailed");
  const outboxDispatcher = new OutboxDispatcherService({
    store: deps.processStore,
    handlers: createIngestionPullIntentHandlers({
      runPort: { run: runIngestionPull } satisfies IngestionPullRunPort,
      commands: {
        recordRunCompleted: (args) => recordCompleted.fn(args),
        recordRunFailed: (args) => recordFailed.fn(args),
      },
    }),
    maxAttempts: INGESTION_PULL_MAX_ATTEMPTS,
    leaseDurationMs: INGESTION_PULL_LEASE_DURATION_MS,
    processNames: [INGESTION_PULL_PROCESS_NAME],
    concurrency: INGESTION_PULL_CONCURRENCY,
  });
  const processOutboxWorker = new ProcessOutboxWorker({
    dispatcher: outboxDispatcher,
    logger,
    batchSize: INGESTION_PULL_CONCURRENCY,
  });
  const subscriber = createIngestionPullProcessSubscriber({
    processManager,
    notifyOutbox: () => processOutboxWorker.notify(),
  });
  const pipeline = deps.eventSourcing.register(
    createIngestionPullProcessingPipeline({
      runStatusStore: new PrismaIngestionPullRunProjectionRepository(
        deps.prisma,
      ),
      subscribers: [subscriber],
    }),
  );
  const ingestionPullCommands = mapCommands(pipeline.commands);
  recordCompleted.resolve((args) =>
    ingestionPullCommands.recordRunCompleted(args as never),
  );
  recordFailed.resolve((args) =>
    ingestionPullCommands.recordRunFailed(args as never),
  );

  if (deps.runsWorkers) {
    processOutboxWorker.start();
    void reconcileIngestionPullProcesses({
      prisma: deps.prisma,
      commands: ingestionPullCommands,
    })
      .then(({ reconciled, failed }) => {
        if (failed > 0) {
          logger.warn(
            { reconciled, failed },
            "Some ingestion pull processes failed reconciliation; the next boot retries",
          );
        }
      })
      .catch((error: unknown) => {
        logger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "Ingestion pull process reconciliation failed; the next boot retries",
        );
      });
  }

  return {
    commands: ingestionPullCommands,
    processManager,
    processOutboxWorker,
  };
}

/**
 * Registers the complete enterprise pipeline set with the shared event-sourcing
 * runtime. Domain definitions and their process/effect wiring remain under
 * /ee; the core registry only composes this set with the core pipelines.
 */
export function registerEnterprisePipelineSet(
  deps: EnterprisePipelineRuntimeDeps,
) {
  const ingestionPull = registerIngestionPullPipeline(deps);

  return {
    commands: { ingestionPull: ingestionPull.commands },
    processManagers: {
      [INGESTION_PULL_PROCESS_NAME]: ingestionPull.processManager,
    },
    notifyOutbox: () => ingestionPull.processOutboxWorker.notify(),
    runsWorkers: deps.runsWorkers,
    stop: () => ingestionPull.processOutboxWorker.stop(),
  };
}

export type EnterprisePipelineCommands = ReturnType<
  typeof registerEnterprisePipelineSet
>["commands"];

export function createNoopEnterprisePipelineCommands(): EnterprisePipelineCommands {
  const noop = async () => undefined;
  return {
    ingestionPull: {
      configure: noop,
      disable: noop,
      recordRunCompleted: noop,
      recordRunFailed: noop,
    },
  } satisfies EnterprisePipelineCommands;
}
