import { createIngestionPullProcessingPipeline } from "@ee/event-sourcing/pipelines/ingestion-pull-processing";
import type { IngestionPullOutcomeCommands } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/process-manager/ingestionPullEffects";
import { createPulledUsageProcessingPipeline } from "@ee/event-sourcing/pipelines/pulled-usage-processing";
import type { PulledUsageLedgerProcessDeps } from "@ee/governance/process-manager/pulledUsageLedger.process";
import { reconcileIngestionPullProcesses } from "@ee/governance/services/pullers/ingestionPullLifecycle";
import {
  type PulledUsageDispatcher,
  runIngestionPull,
} from "@ee/governance/services/pullers/pullerWorker";
import { PrismaIngestionPullRunProjectionRepository } from "@ee/governance/services/pullers/repositories/ingestion-pull-run-projection.prisma.repository";
import type { EventSourcing } from "@langwatch/eventing";
import { mapCommands } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";

const logger = createLogger("langwatch:enterprise:event-sourcing");

/** Enterprise-owned pipeline dependencies supplied by the app composition root. */
export interface EnterprisePipelineSetConfig {
  prisma: PrismaClient;
  runsWorkers: boolean;
  /**
   * The pulled-usage ledger writer. Absent without ClickHouse — the pipeline
   * still records every observation, only the ledger row is skipped.
   */
  pulledUsageLedger?: PulledUsageLedgerProcessDeps;
}

type EnterprisePipelineRuntimeDeps = EnterprisePipelineSetConfig & {
  eventSourcing: EventSourcing;
};

function registerIngestionPullPipeline(
  deps: EnterprisePipelineRuntimeDeps & {
    /** The pulled-usage write surface the pull effect emits cost through. */
    pulledUsage: PulledUsageDispatcher;
  },
) {
  // Late-bind the outcome commands: they are this same pipeline's own write
  // surface and exist only after `.build()`; dispatch happens long after that.
  let outcomeCommands: IngestionPullOutcomeCommands | null = null;
  const pipeline = deps.eventSourcing.register(
    createIngestionPullProcessingPipeline({
      runStatusStore: new PrismaIngestionPullRunProjectionRepository(
        deps.prisma,
      ),
      dispatch: {
        runPort: {
          run: (params) =>
            runIngestionPull({ ...params, pulledUsage: deps.pulledUsage }),
        },
        commands: () => {
          if (!outcomeCommands) {
            throw new Error(
              "Ingestion pull outcome commands used before the pipeline was built",
            );
          }
          return outcomeCommands;
        },
      },
    }),
  );
  const ingestionPullCommands = mapCommands(pipeline.commands);
  outcomeCommands = {
    recordRunCompleted: (args) =>
      ingestionPullCommands.recordRunCompleted(args as never),
    recordRunFailed: (args) =>
      ingestionPullCommands.recordRunFailed(args as never),
  };

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
 * The `pulled_usage` write surface (ADR-088).
 *
 * A sibling of the ingestion-pull pipeline rather than a part of it: that one
 * is per-source and per-run, this one is per usage item, and a per-run stream
 * cannot carry a per-item price. The puller effect dispatches
 * `recordPulledUsage` in the same loop that writes the OCSF audit row.
 */
function registerPulledUsagePipeline(deps: EnterprisePipelineRuntimeDeps) {
  const pipeline = deps.eventSourcing.register(
    createPulledUsageProcessingPipeline({ ledger: deps.pulledUsageLedger }),
  );
  return { commands: mapCommands(pipeline.commands) };
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
  // Pulled usage registers first because the pull effect emits through it.
  // Its commands exist the moment its own pipeline is built, so this one
  // needs no late-binding getter — only the ingestion-pull pipeline's own
  // outcome commands do, and those are its own write surface.
  const pulledUsage = registerPulledUsagePipeline(deps);
  const ingestionPull = registerIngestionPullPipeline({
    ...deps,
    // No cast. The dispatcher's argument type IS the command's, so renaming a
    // field on the event schema breaks this line at compile time instead of
    // surfacing as an outbox parse failure in production.
    pulledUsage: { recordPulledUsage: pulledUsage.commands.recordPulledUsage },
  });

  return {
    commands: {
      ingestionPull: ingestionPull.commands,
      pulledUsage: pulledUsage.commands,
    },
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
    pulledUsage: {
      recordPulledUsage: noop,
    },
  } satisfies EnterprisePipelineCommands;
}
