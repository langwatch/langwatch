/**
 * Users/min of a listed run whose jobs append through the real event store path (repository,
 * routed member, tenant guard, 64-statement limiter) to ClickHouse. A script, not a suite: from
 * packages/process-stores, `node_modules/.bin/tsx <this file>`; BENCH_* knobs are read below.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  type EventingClickHouseClientResolver,
} from "@langwatch/eventing/server";
import {
  GroupQueueProcessor,
  type GroupQueueContext,
  type GroupQueueContextMetadata,
} from "@langwatch/group-queue";

import { buildClickHouse } from "../clickhouse-member.ts";
import { buildRedis } from "../datastore-members.ts";

const env = (name: string, fallback: number): number => {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : Number(raw);
};

const USERS = env("BENCH_USERS", 6_000);
const PAGE = env("BENCH_PAGE", 2_000);
const BACKLOG = env("BENCH_BACKLOG", 30_000);
const FANOUT = env("BENCH_FANOUT", 3);
const CONCURRENCY = env("BENCH_CONCURRENCY", 0);
const FOLD = process.env.BENCH_FOLD !== "0";
const CH_URL = process.env.BENCH_CH_URL ?? "http://127.0.0.1:18123";
const REDIS_URL = process.env.LANGWATCH_TEST_REDIS_URL ?? "redis://127.0.0.1:16379";

type Kind = "command" | "follow" | "backlog";
type BenchPayload = { kind: Kind; tenant: string; group: string; at: number; step?: number };

class BenchContext implements GroupQueueContext {
  readonly storage = new AsyncLocalStorage<GroupQueueContextMetadata>();
  capture(): GroupQueueContextMetadata | undefined {
    return this.storage.getStore();
  }
  run<T>(metadata: GroupQueueContextMetadata | undefined, operation: () => Promise<T>): Promise<T> {
    return this.storage.run(metadata ?? {}, operation);
  }
}

/** Every bench tenant is a user, which the directory places on the platform, as users are. */
const directory = { organizationForTenant: async () => "__platform__" };
const clickhouse = buildClickHouse({ config: { url: CH_URL }, directory });
let inserts = 0;
const resolveClient: EventingClickHouseClientResolver = (tenantId) =>
  Promise.resolve({
    query: () => Promise.reject(new Error("the bench reads nothing")),
    insert: async (request) => {
      inserts++;
      await clickhouse.value.insert({
        tenantId,
        table: request.table,
        rows: request.values,
        settings: request.clickhouse_settings,
        ...(request.tenantIds === undefined ? {} : { tenantIds: request.tenantIds }),
      });
    },
  });
const repository = EventingClickHouseEventRepository.create({
  resolveClient,
  retention: createEventingRetentionConfiguration({ defaultRetentionDays: 49 }),
  ...(FOLD ? { organizationOf: directory.organizationForTenant } : {}),
});

const done: Record<Kind, number> = { command: 0, follow: 0, backlog: 0 };
const handlerMs: Record<Kind, number> = { command: 0, follow: 0, backlog: 0 };

function appendOf(payload: BenchPayload): Promise<void> {
  return repository.insertEventRecords([
    {
      TenantId: payload.tenant,
      AggregateType: "bench_user",
      AggregateId: payload.group,
      EventId: `${payload.group}:${payload.at}:${payload.step ?? 0}`,
      EventTimestamp: payload.at,
      EventOccurredAt: payload.at,
      EventType: `bench.${payload.kind}`,
      EventVersion: "1",
      EventPayload: JSON.stringify({ group: payload.group }),
      ProcessingTraceparent: "",
      IdempotencyKey: `${payload.group}:${payload.at}:${payload.step ?? 0}`,
    },
  ]);
}

async function main(): Promise<void> {
  const redisMember = buildRedis({ url: REDIS_URL });
  const redis = redisMember.value;
  const runId = Math.random().toString(36).slice(2, 10);
  const queueName = `{bench/append/${runId}}`;
  const context = new BenchContext();
  const queues: GroupQueueProcessor<BenchPayload>[] = [];
  const producer = () => queues[0]!;
  const hourAgo = Date.now() - 3_600_000;

  const handle = async (payload: BenchPayload): Promise<void> => {
    const started = performance.now();
    await appendOf(payload);
    if (payload.kind === "command") {
      const follow = (step: number): BenchPayload => ({
        kind: "follow",
        tenant: payload.tenant,
        group: `${payload.tenant}/f${step}/${payload.group}`,
        at: payload.at,
        step,
      });
      if (FANOUT > 0) await producer().sendBatch([follow(1)]);
      for (let step = 2; step <= FANOUT; step++) await producer().send(follow(step));
    }
    handlerMs[payload.kind] += performance.now() - started;
    done[payload.kind]++;
  };

  const makeQueue = (listed: boolean): GroupQueueProcessor<BenchPayload> => {
    const queue = new GroupQueueProcessor<BenchPayload>(
      {
        name: queueName,
        process: handle,
        groupKey: (payload) => payload.group,
        identify: (payload) => `${payload.group}:${payload.step ?? 0}`,
        score: (payload) => payload.at,
        ...(CONCURRENCY > 0 ? { options: { globalConcurrency: CONCURRENCY } } : {}),
      },
      redis,
      { consumerEnabled: true, context, ...(listed ? { dispatchListed: true } : {}) },
    );
    queues.push(queue);
    return queue;
  };

  const sender = makeQueue(false);
  sender.pause();
  await sender.waitUntilReady();
  for (let start = 0; start < BACKLOG; start += PAGE) {
    const count = Math.min(PAGE, BACKLOG - start);
    await sender.sendBatch(
      Array.from({ length: count }, (_, offset) => {
        const tenant = `bt${start + offset}`;
        return { kind: "backlog", tenant, group: `${tenant}/backlog`, at: hourAgo };
      }),
    );
  }
  const listed = makeQueue(true);
  await listed.waitUntilReady();
  sender.resume();

  inserts = 0;
  const cpuBefore = process.cpuUsage();
  const eluBefore = performance.eventLoopUtilization();
  const started = performance.now();
  await sender.runListedWork({
    name: `bench:${runId}`,
    timeoutMs: 120_000,
    work: async (list) => {
      for (let start = 0; start < USERS; start += PAGE) {
        const count = Math.min(PAGE, USERS - start);
        const now = Date.now();
        await sender.sendBatch(
          Array.from({ length: count }, (_, offset) => {
            const tenant = `u${runId}${start + offset}`;
            return { kind: "command", tenant, group: `${tenant}/command/${tenant}`, at: now };
          }),
        );
        await list?.waitForRoom({ maxOutstanding: 1_000 });
      }
    },
  });
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuBefore);
  const elu = performance.eventLoopUtilization(eluBefore);
  const listedJobs = done.command + done.follow;
  const allJobs = listedJobs + done.backlog;

  console.log(
    JSON.stringify({
      shape: { USERS, BACKLOG, FANOUT, CONCURRENCY, FOLD },
      elapsedS: +(elapsedMs / 1000).toFixed(2),
      usersPerMin: Math.round(done.command / (elapsedMs / 60_000)),
      listedJobsPerS: Math.round(listedJobs / (elapsedMs / 1000)),
      allJobsPerS: Math.round(allJobs / (elapsedMs / 1000)),
      done,
      avgHandlerMs: Object.fromEntries(
        (Object.keys(done) as Kind[]).map((kind) => [
          kind,
          done[kind] ? +(handlerMs[kind] / done[kind]).toFixed(1) : 0,
        ]),
      ),
      inserts,
      cpuMsPerJob: +((cpu.user + cpu.system) / 1000 / allJobs).toFixed(3),
      eventLoopUtilization: +elu.utilization.toFixed(3),
    }),
  );

  await Promise.all(queues.map((queue) => queue.close()));
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${queueName}*`, "COUNT", 1000);
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
  await redis.srem("{gq-registry}:names", queueName);
  await redisMember.close?.();
  await clickhouse.close?.();
}

await main();
