import { createIngestionPullProcessingPipeline } from "@ee/event-sourcing/pipelines/ingestion-pull-processing";
import type {
  IngestionPullConfiguredData,
  IngestionPullDisabledData,
  IngestionPullRunCompletedData,
  IngestionPullRunFailedData,
} from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/events";
import { reconcileIngestionPullProcesses } from "@ee/governance/services/pullers/ingestionPullLifecycle";
import { runIngestionPull } from "@ee/governance/services/pullers/pullerWorker";
import { createIngestionPullRunStatusStore } from "@ee/governance/services/pullers/repositories/ingestion-pull-run-projection.prisma.repository";
import type {
  CommandClient,
  DispatchResult,
  EventSourcingService,
  Metrics,
} from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";

const logger = createLogger("langwatch:enterprise:event-sourcing");

type TenantContext = { readonly tenantId: string };

/** Enterprise-owned pipeline dependencies supplied by the app composition root. */
export interface EnterprisePipelineSetConfig {
  readonly prisma: PrismaClient;
  readonly runsWorkers: boolean;
  readonly metrics?: Metrics;
  /** The composition root's own service: `register` mounts the enterprise
   * pipelines onto the shared registry, and `commands` is the one dispatch
   * surface every mapped command goes through — never a pipeline's own
   * `commands[name].handle`, which would skip the log and the lane fan-out. */
  readonly service: Pick<EventSourcingService, "register" | "commands">;
}

/**
 * The four commands the enterprise ingestion-pull surface exposes, each named
 * explicitly rather than mapped generically so its input type is the payload
 * schema's own — the same `(input, ctx)` shape as every core pipeline's mapped
 * commands.
 */
function ingestionPullCommands(client: CommandClient) {
  return {
    configure: (
      input: IngestionPullConfiguredData,
      ctx: TenantContext,
    ): Promise<DispatchResult> => client.send("configure", input, ctx),
    disable: (
      input: IngestionPullDisabledData,
      ctx: TenantContext,
    ): Promise<DispatchResult> => client.send("disable", input, ctx),
    recordRunCompleted: (
      input: IngestionPullRunCompletedData,
      ctx: TenantContext,
    ): Promise<DispatchResult> => client.send("recordRunCompleted", input, ctx),
    recordRunFailed: (
      input: IngestionPullRunFailedData,
      ctx: TenantContext,
    ): Promise<DispatchResult> => client.send("recordRunFailed", input, ctx),
  };
}

function registerIngestionPullPipeline(deps: EnterprisePipelineSetConfig) {
  const commands = ingestionPullCommands(deps.service.commands);

  deps.service.register(
    createIngestionPullProcessingPipeline({
      runStatusStore: createIngestionPullRunStatusStore({
        prisma: deps.prisma,
      }),
      runPort: { run: runIngestionPull },
      // The run outcomes are this pipeline's own commands. The client resolves
      // by name at send time, so naming them here — before the pipeline has
      // registered — is sound.
      commands,
      metrics: deps.metrics,
    }),
  );

  if (deps.runsWorkers) {
    void reconcileIngestionPullProcesses({ prisma: deps.prisma, commands })
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

  return { commands };
}

/**
 * Registers the complete enterprise pipeline set on the shared registry.
 * Domain definitions stay under /ee; their process managers are declared on
 * the pipelines, so the shared runtime owns all workers — the core composition
 * root only composes this set with the core pipelines.
 */
export function registerEnterprisePipelineSet(
  deps: EnterprisePipelineSetConfig,
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
  const noop = async () => ({ events: [] });
  return {
    ingestionPull: {
      configure: noop,
      disable: noop,
      recordRunCompleted: noop,
      recordRunFailed: noop,
    },
  } satisfies EnterprisePipelineCommands;
}
