import type {
  EventingGroupQueueFactoryOptions,
  RedisReplayMarkerChecker,
  RetentionPolicyResolver,
} from "@langwatch/eventing";
import type { EventingRetentionConfiguration } from "@langwatch/eventing/server";
import type { TopicServerInstallerDependencies } from "@langwatch/topic-server";
import type { PrismaClient } from "~/generated/prisma/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { PipelineRegistryWorkerCapabilities } from "~/server/event-sourcing/registration/pipelineRegistry";
import { type AppConfig, type ProcessRole, roleRunsWorkers } from "./config";

/**
 * Who claims `event-sourcing/jobs` in this process.
 *
 * `"app-owned"` is what every role has done until now: a worker-capable App
 * builds its own consumers as a side effect of creating queue definitions.
 * `"external"` says another composition in the same process owns them, so this
 * App builds the producer surface and nothing else — which is byte-for-byte the
 * web-role App that has run in production for months.
 */
export type EventingConsumerOwnership = "app-owned" | "external";

/**
 * Whether the App this composition is building claims the shared queue.
 *
 * Two independent conditions, and both have to hold. A web or migration role
 * never consumed and still does not, whatever it asks for; and a worker-capable
 * role consumes unless a caller has said it is handing consumers to someone
 * else. Absent option means app-owned, so every existing caller keeps the exact
 * behaviour it had.
 */
export function appOwnsEventingConsumersFor({
  eventingConsumers,
  processRole,
}: {
  eventingConsumers: EventingConsumerOwnership | undefined;
  processRole: ProcessRole | undefined;
}): boolean {
  return eventingConsumers !== "external" && roleRunsWorkers(processRole);
}

/**
 * The eventing infrastructure the App built, as the objects a second graph
 * mounts onto rather than as clients of its own.
 *
 * Sharing the instances is the point. Two `EventSourcing` runtimes in one
 * process over two Redis connections would offload payloads through two staging
 * paths and stage retention against two configurations; over these they are one
 * substrate with two graphs on it.
 *
 * `groupQueue` is absent exactly when the App has no Redis, which is also when
 * the App itself built no queue factory — there is no queue for a second graph
 * to join either.
 */
export type WorkerEventingSubstrate = {
  prisma: PrismaClient;
  resolveClickHouseClient: ClickHouseClientResolver;
  groupQueue: EventingGroupQueueFactoryOptions["dependencies"] | undefined;
  persistenceRetention: EventingRetentionConfiguration;
  retentionPolicyResolver: RetentionPolicyResolver;
  replayMarkerChecker: RedisReplayMarkerChecker | undefined;
};

/**
 * What a packaged worker composition needs from this App to mount the same
 * eventing graph on a second runtime inside the same process.
 *
 * Populated on worker-capable roles only: a web process has no packaged worker
 * to hand anything to, and offering it one would invite a second consumer into
 * the process that must never have one.
 *
 * `appOwnsEventingConsumers` is here so the receiving composition can refuse to
 * start rather than become a second consumer of one queue — the App reports
 * what it did, and the receiver decides whether that is compatible with what it
 * was asked to do.
 */
export type WorkerEventingHandoff = {
  appOwnsEventingConsumers: boolean;
  /** The one `config.isSaas` both graphs' global projections derive from. */
  isSaas: AppConfig["isSaas"];
  capabilities: PipelineRegistryWorkerCapabilities;
  substrate: WorkerEventingSubstrate;
  topic: TopicServerInstallerDependencies;
};
