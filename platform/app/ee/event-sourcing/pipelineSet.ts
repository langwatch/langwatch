import { createIngestionPullProcessingPipeline } from "@ee/event-sourcing/pipelines/ingestion-pull-processing";
import { reconcileIngestionPullProcesses } from "@ee/governance/services/pullers/ingestionPullLifecycle";
import { runIngestionPull } from "@ee/governance/services/pullers/pullerWorker";
import { PrismaIngestionPullRunProjectionRepository } from "@ee/governance/services/pullers/repositories/ingestion-pull-run-projection.prisma.repository";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import type { CommandBus } from "~/server/event-sourcing.old/commands/commandBus";
import type { EventSourcing } from "~/server/event-sourcing.old/eventSourcing";
import { mapCommands } from "~/server/event-sourcing.old/mapCommands";

const logger = createLogger("langwatch:enterprise:event-sourcing");

/** Enterprise-owned pipeline dependencies supplied by the app composition root. */
export interface EnterprisePipelineSetConfig {
  prisma: PrismaClient;
  runsWorkers: boolean;
  /** ADR-082 §5 — identity-keyed dispatch, handed to the pipelines below. */
  commands: CommandBus;
}

type EnterprisePipelineRuntimeDeps = EnterprisePipelineSetConfig & {
  eventSourcing: EventSourcing;
};

function registerIngestionPullPipeline(deps: EnterprisePipelineRuntimeDeps) {
  const pipeline = deps.eventSourcing.register(
    createIngestionPullProcessingPipeline({
      runStatusStore: new PrismaIngestionPullRunProjectionRepository(
        deps.prisma,
      ),
      runPort: { run: runIngestionPull },
      // The pipeline binds its own outcome commands through the bus, so
      // nothing here is resolved after `.build()` (ADR-082 §5).
      commands: deps.commands,
    }),
  );
  const ingestionPullCommands = mapCommands(pipeline.commands);

  if (deps.runsWorkers) {
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

  return { commands: ingestionPullCommands };
}

/**
 * Registers the complete enterprise pipeline set with the shared
 * event-sourcing runtime. Domain definitions stay under /ee; their process
 * managers are declared on the pipelines (ADR-052 builder), so the shared
 * ProcessRuntime owns all workers — the core registry only composes this set
 * with the core pipelines.
 */
export function registerEnterprisePipelineSet(
  deps: EnterprisePipelineRuntimeDeps,
) {
  const ingestionPull = registerIngestionPullPipeline(deps);

  return {
    commands: { ingestionPull: ingestionPull.commands },
  };
}

type EnterprisePipelineCommands = ReturnType<
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
