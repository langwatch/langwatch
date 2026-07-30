import type { ClickHouseClient } from "@langwatch/clickhouse";
import {
  type BuiltCommand,
  type CommandClient,
  type ConsumerBudget,
  createEventProducer,
  createEventSourcingService,
  createLaneConsumer,
  createRegistry,
  createReplay,
  type DispatchResult,
  type Metrics,
  type Registry,
  type z,
} from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { createAutomationsPipeline } from "./automations";
import { createBillingReportingPipeline } from "./billing-reporting";
import { createBlobCleanupMount } from "./blob-maintenance";
import { createCodingAgentProcessingPipeline } from "./coding-agent-processing";
import { evaluationProcessing as createEvaluationProcessingPipeline } from "./evaluation-processing";
import { createExperimentRunProcessingPipeline } from "./experiment-run-processing";
import { createLangyConversationProcessingPipeline } from "./langy-conversation-processing";
import { createLangySessionKeyReapMount } from "./langy-maintenance";
import { createLogProcessingPipeline } from "./log-processing";
import { createMetricProcessingPipeline } from "./metric-processing";
import type { EngineInfra } from "./ports";
import {
  buildEnginePorts,
  createGenericLaneExecutors,
  createOutboxWorker,
  createProcessWakePoller,
} from "./ports";
import type { ScheduledTickMount } from "./scheduledTick";
import { createSimulationProcessingPipeline } from "./simulation-processing";
import { createTopicClusteringProcessingPipeline } from "./topic-clustering-processing";
import { createTraceProcessingPipeline } from "./trace-processing";

const logger = createLogger("langwatch:event-sourcing:registry");

/**
 * The composition root (ADR-110 decision 5): the one module naming both a
 * concrete pipeline's dependencies and the store it writes to. Every domain
 * field's type is read off the pipeline's own factory via `Parameters<>`, so
 * a sibling changing a pipeline's deps changes this file's type with it
 * rather than drifting out of sync with a hand-copied interface.
 */
export interface EventSourcingRegistryDeps {
  readonly client: ClickHouseClient;
  /** Absent gives the fully in-memory graph ADR-110 decision 4 requires. */
  readonly infra?: EngineInfra;
  readonly metrics?: Metrics;
  readonly budget?: Partial<ConsumerBudget>;

  readonly automations: Parameters<typeof createAutomationsPipeline>[0];
  readonly billing: Omit<
    Parameters<typeof createBillingReportingPipeline>[0],
    "client"
  >;
  readonly blobCleanup: Omit<
    Parameters<typeof createBlobCleanupMount>[0],
    "metrics"
  >;
  readonly codingAgent: Omit<
    Parameters<typeof createCodingAgentProcessingPipeline>[0],
    "client" | "metrics"
  >;
  readonly evaluation: Omit<
    Parameters<typeof createEvaluationProcessingPipeline>[0],
    "client" | "metrics"
  >;
  readonly experimentRun: Omit<
    Parameters<typeof createExperimentRunProcessingPipeline>[0],
    "client" | "metrics"
  >;
  readonly langyConversation: Omit<
    Parameters<typeof createLangyConversationProcessingPipeline>[0],
    "client" | "metrics"
  >;
  readonly langySessionKeyReap: Omit<
    Parameters<typeof createLangySessionKeyReapMount>[0],
    "metrics"
  >;
  readonly simulation: Omit<
    Parameters<typeof createSimulationProcessingPipeline>[0],
    "client" | "metrics"
  >;
  readonly topicClustering: Omit<
    Parameters<typeof createTopicClusteringProcessingPipeline>[0],
    "client" | "metrics"
  >;
  readonly trace: Omit<
    Parameters<typeof createTraceProcessingPipeline>[0],
    "client" | "metrics"
  >;
}

type MappedCommand<Input extends z.ZodTypeAny> = (
  input: z.infer<Input>,
  ctx: { readonly tenantId: string },
) => Promise<DispatchResult>;

type MapCommands<T extends Record<string, BuiltCommand<never, never>>> = {
  [K in keyof T]: T[K] extends BuiltCommand<never, infer Input>
    ? MappedCommand<Input>
    : never;
};

/** Every dispatch goes through the shared `CommandClient` — never straight to
 * `pipeline.commands[name].handle` — so a mapped command still reaches the
 * event log and stages a job per subscriber, exactly like any other caller. */
function mapCommands<T extends Record<string, BuiltCommand<never, never>>>(
  client: CommandClient,
  commands: T,
): MapCommands<T> {
  const mapped: Record<string, MappedCommand<z.ZodTypeAny>> = {};
  for (const name of Object.keys(commands)) {
    mapped[name] = (input, ctx) => client.send(name, input, ctx);
  }
  return mapped as MapCommands<T>;
}

const DEFAULT_BUDGET: ConsumerBudget = {
  maxJobs: 100,
  maxBytes: 4 * 1024 * 1024,
  maxInFlight: 4,
  leaseMs: 30_000,
  parkAfterFailures: 5,
  tenantSoftCap: 0,
};

function scheduleTicks(mounts: readonly ScheduledTickMount<string>[]) {
  let timers: NodeJS.Timeout[] = [];
  return {
    start() {
      if (timers.length > 0) return;
      timers = mounts.map((mount) =>
        setInterval(() => {
          void mount.run().catch((error: unknown) => {
            logger.error(
              {
                tick: mount.name,
                error: error instanceof Error ? error.message : String(error),
              },
              "scheduled tick failed; the next interval retries",
            );
          });
        }, mount.intervalMs),
      );
    },
    stop() {
      for (const timer of timers) clearInterval(timer);
      timers = [];
    },
  };
}

export function createEventSourcingRegistry(deps: EventSourcingRegistryDeps) {
  const tenantSoftCap =
    deps.infra?.tenantSoftCap ?? deps.budget?.tenantSoftCap ?? 0;
  const ports = buildEnginePorts({
    ...deps.infra,
    metrics: deps.metrics,
    tenantSoftCap,
  });

  const registry = createRegistry();
  const producer = createEventProducer({
    eventLog: ports.eventLog,
    queue: ports.queue,
    registry,
    metrics: ports.metrics,
  });
  const executors = createGenericLaneExecutors({
    processStore: ports.processStore,
    outbox: ports.outbox,
    clock: ports.clock,
  });
  const budget: ConsumerBudget = {
    ...DEFAULT_BUDGET,
    ...deps.budget,
    tenantSoftCap,
  };
  const consumer = createLaneConsumer({
    queue: ports.queue,
    spool: ports.spool,
    registry,
    executors,
    budget,
    metrics: ports.metrics,
    enabled: ports.enabled,
  });
  const replay = createReplay({
    eventLog: ports.eventLog,
    registry,
    metrics: ports.metrics,
  });
  const service = createEventSourcingService({
    ports,
    registry,
    producer,
    consumer,
    replay,
  });

  const automations = createAutomationsPipeline(deps.automations);
  service.register(automations);
  const billing = createBillingReportingPipeline({
    client: deps.client,
    ...deps.billing,
  });
  service.register(billing);
  const codingAgent = createCodingAgentProcessingPipeline({
    client: deps.client,
    metrics: deps.metrics,
    ...deps.codingAgent,
  });
  service.register(codingAgent);
  const evaluation = createEvaluationProcessingPipeline({
    client: deps.client,
    metrics: deps.metrics,
    ...deps.evaluation,
  });
  service.register(evaluation);
  const experimentRun = createExperimentRunProcessingPipeline({
    client: deps.client,
    metrics: deps.metrics,
    ...deps.experimentRun,
  });
  service.register(experimentRun);
  const langyConversation = createLangyConversationProcessingPipeline({
    client: deps.client,
    metrics: deps.metrics,
    ...deps.langyConversation,
  });
  service.register(langyConversation);
  const log = createLogProcessingPipeline({ client: deps.client });
  service.register(log);
  const metric = createMetricProcessingPipeline({ client: deps.client });
  service.register(metric);
  const simulation = createSimulationProcessingPipeline({
    client: deps.client,
    metrics: deps.metrics,
    ...deps.simulation,
  });
  service.register(simulation);
  const topicClustering = createTopicClusteringProcessingPipeline({
    client: deps.client,
    metrics: deps.metrics,
    ...deps.topicClustering,
  });
  service.register(topicClustering);
  const trace = createTraceProcessingPipeline({
    client: deps.client,
    metrics: deps.metrics,
    ...deps.trace,
  });
  service.register(trace);

  // Scheduled maintenance: `ScheduledTickMount`, not `BuiltPipeline` — no
  // aggregate, no events, no lane, so nothing here calls `service.register`.
  // Construction is unconditional like every other member; only the interval
  // is gated on `runsConsumers`.
  const blobCleanup = createBlobCleanupMount({
    ...deps.blobCleanup,
    metrics: deps.metrics,
  });
  const langySessionKeyReap = createLangySessionKeyReapMount({
    ...deps.langySessionKeyReap,
    metrics: deps.metrics,
  });
  const ticks = scheduleTicks([blobCleanup, langySessionKeyReap]);

  const outboxWorker = createOutboxWorker({
    outbox: ports.outbox,
    registry,
    clock: ports.clock,
    metrics: deps.metrics,
  });
  const wakePoller = createProcessWakePoller({
    processStore: ports.processStore,
    outbox: ports.outbox,
    registry,
    clock: ports.clock,
    metrics: deps.metrics,
  });

  const commands = {
    automations: mapCommands(service.commands, automations.commands),
    billing: mapCommands(service.commands, billing.commands),
    codingAgents: mapCommands(service.commands, codingAgent.commands),
    evaluations: mapCommands(service.commands, evaluation.commands),
    experimentRuns: mapCommands(service.commands, experimentRun.commands),
    langy: mapCommands(service.commands, langyConversation.commands),
    logs: mapCommands(service.commands, log.commands),
    metrics: mapCommands(service.commands, metric.commands),
    simulations: mapCommands(service.commands, simulation.commands),
    topicClustering: mapCommands(service.commands, topicClustering.commands),
    traces: mapCommands(service.commands, trace.commands),
    // The EE pipeline set still targets the retired `EventSourcing` class,
    // and even importing its noop helper eagerly pulls in
    // `ee/event-sourcing/pipelines/ingestion-pull-processing`, which itself
    // imports a deleted `event-sourcing.old` path — so the module fails to
    // load at all, not just the one function this file would otherwise use.
    // Inlined rather than imported until EE ports its pipeline off the
    // retired builder; the shape matches `createNoopEnterprisePipelineCommands()`.
    ingestionPull: {
      configure: async () => undefined,
      disable: async () => undefined,
      recordRunCompleted: async () => undefined,
      recordRunFailed: async () => undefined,
    },
  };

  let consumingStarted = false;

  return {
    commands,
    registry: registry as Registry,

    async start(args: { readonly runsConsumers: boolean }): Promise<void> {
      await service.start(args);
      if (args.runsConsumers && !consumingStarted) {
        consumingStarted = true;
        ticks.start();
        outboxWorker.start();
        wakePoller.start();
      }
    },

    async stop(): Promise<void> {
      if (!consumingStarted) {
        await service.stop();
        return;
      }
      // Stop claiming new work everywhere first, then let whatever is
      // already in flight settle, then drain the lane consumer — a worker
      // killed here loses no lease permanently, it just times out.
      consumingStarted = false;
      ticks.stop();
      await Promise.all([outboxWorker.stop(), wakePoller.stop()]);
      await service.stop();
    },

    replay: service.replay,
  };
}

export type AppCommands = ReturnType<
  typeof createEventSourcingRegistry
>["commands"];
