import {
  type ClickHouseClient,
  clickhouseEventLog,
  createClickHouseClient,
} from "@langwatch/clickhouse";
import {
  type ConsumerBudget,
  createEventProducer,
  createEventSourcingService,
  createLaneConsumer,
  createRegistry,
  type EnginePorts,
  type EventSourcingService,
} from "@langwatch/event-sourcing";
import type { Redis } from "ioredis";
import {
  buildEnginePorts,
  createGenericLaneExecutors,
} from "~/server/event-sourcing/ports";
import { createSimulationProcessingPipeline } from "~/server/event-sourcing/simulation-processing";

/** Single worker, so per-lane serialization is the thing under test, not the
 * scheduler's fairness policy. */
export const TEST_BUDGET: ConsumerBudget = {
  maxJobs: 10,
  maxBytes: 4 * 1024 * 1024,
  maxInFlight: 1,
  leaseMs: 5_000,
  parkAfterFailures: 3,
  tenantSoftCap: 0,
};

export function buildTestClickHouseClient(url: string): ClickHouseClient {
  return createClickHouseClient({ url });
}

export interface SimulationEngine {
  readonly service: EventSourcingService;
  readonly ports: EnginePorts;
}

/**
 * `simulation-processing` built with only `{ client }`: no process managers,
 * no subscribers, so the only thing `queueRun` fans out to is the
 * `simulationRunState` fold. Real ClickHouse event log, real Redis lane
 * queue and blob spool — the same `buildEnginePorts` the app's own
 * composition root uses, not a hand-rolled substitute.
 */
export function buildSimulationEngine(args: {
  readonly client: ClickHouseClient;
  readonly redis: Redis;
  readonly budget?: ConsumerBudget;
}): SimulationEngine {
  const registry = createRegistry();
  const ports = buildEnginePorts({
    redis: args.redis,
    eventLog: clickhouseEventLog({ client: args.client }),
    clock: { now: () => Date.now() },
  });
  const producer = createEventProducer({
    eventLog: ports.eventLog,
    queue: ports.queue,
    registry,
  });
  const executors = createGenericLaneExecutors({
    processStore: ports.processStore,
    outbox: ports.outbox,
    clock: ports.clock,
  });
  const consumer = createLaneConsumer({
    queue: ports.queue,
    spool: ports.spool,
    registry,
    executors,
    budget: args.budget ?? TEST_BUDGET,
  });
  const service = createEventSourcingService({
    ports,
    registry,
    producer,
    consumer,
  });

  service.register(createSimulationProcessingPipeline({ client: args.client }));

  return { service, ports };
}
