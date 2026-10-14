/**
 * Jobs/s of a listed run beside a backlog, shaped like an upgrade step recording a fact per user.
 * A script, not a suite: from packages/group-queue, `node_modules/.bin/tsx <this file>`; knobs
 * are the BENCH_* reads below, and BENCH_CH_URL stores each job's row in a ClickHouse.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

import IORedis from "ioredis";

import type { GroupQueueContext, GroupQueueContextMetadata } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";

const env = (name: string, fallback: number): number => {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : Number(raw);
};

const USERS = env("BENCH_USERS", 6_000);
const PAGE = env("BENCH_PAGE", 2_000);
const BACKLOG = env("BENCH_BACKLOG", 30_000);
const FANOUT = env("BENCH_FANOUT", 3);
const STORE_MS = env("BENCH_STORE_MS", 0);
const CONCURRENCY = env("BENCH_CONCURRENCY", 0);
const CH_POOL = env("BENCH_CH_POOL", 64);
const MAX_OUTSTANDING = env("BENCH_MAX_OUTSTANDING", 1_000);
/** Tenants the listed users share, so the tenant cap binds (0: a tenant per user). */
const LISTED_TENANTS = env("BENCH_LISTED_TENANTS", 0);
const CH_URL = process.env.BENCH_CH_URL;
/** Folds waiting rows into one statement, this many statements at once (0: one per row). */
const CH_GROUP_COMMIT = env("BENCH_CH_GROUP_COMMIT", 0);
/** Overrides the server's adaptive async-insert flush wait (0: the server's own, 50-200 ms). */
const CH_BUSY_MAX_MS = env("BENCH_CH_BUSY_MAX_MS", 0);
const REDIS_URL =
  process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379";

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

/** A bounded pool, as the ClickHouse client admits at most its open connections at once. */
let chInFlight = 0;
const chWaiters: (() => void)[] = [];
let chInserts = 0;
let chMs = 0;
let chRows = 0;
function rowOf(payload: BenchPayload) {
  return {
    TenantId: payload.tenant,
    IdempotencyKey: `${payload.group}:${payload.at}`,
    AggregateType: "bench_user",
    AggregateId: payload.group,
    EventId: `${payload.group}:${payload.at}:${payload.step ?? 0}`,
    EventType: `bench.${payload.kind}`,
    EventVersion: "1",
    EventTimestamp: payload.at,
    EventPayload: JSON.stringify({ group: payload.group }),
    EventOccurredAt: payload.at,
  };
}

async function insertStatement(rows: readonly object[]): Promise<void> {
  if (chInFlight >= CH_POOL) await new Promise<void>((resolve) => chWaiters.push(resolve));
  chInFlight++;
  const started = performance.now();
  try {
    const busy = CH_BUSY_MAX_MS > 0 ? `, async_insert_busy_timeout_max_ms=${CH_BUSY_MAX_MS}` : "";
    const query = encodeURIComponent(
      `INSERT INTO default.event_log SETTINGS async_insert=1, wait_for_async_insert=1${busy} FORMAT JSONEachRow`,
    );
    const response = await fetch(`${CH_URL}/?query=${query}`, {
      method: "POST",
      body: rows.map((row) => JSON.stringify(row)).join("\n"),
    });
    if (!response.ok) throw new Error(`ClickHouse insert failed: ${await response.text()}`);
    await response.arrayBuffer();
    chInserts++;
    chRows += rows.length;
  } finally {
    chMs += performance.now() - started;
    chInFlight--;
    chWaiters.shift()?.();
  }
}

/** Group commit: rows waiting while every statement slot is busy leave together in the next. */
const pendingRows: { row: object; settle: (error?: unknown) => void }[] = [];
let statementsInFlight = 0;
function flushPending(): void {
  while (statementsInFlight < CH_GROUP_COMMIT && pendingRows.length > 0) {
    const batch = pendingRows.splice(0, 10_000);
    statementsInFlight++;
    void insertStatement(batch.map((entry) => entry.row))
      .then(
        () => batch.forEach((entry) => entry.settle()),
        (error: unknown) => batch.forEach((entry) => entry.settle(error ?? new Error("insert"))),
      )
      .finally(() => {
        statementsInFlight--;
        flushPending();
      });
  }
}

async function insertRow(payload: BenchPayload): Promise<void> {
  if (CH_GROUP_COMMIT <= 0) return insertStatement([rowOf(payload)]);
  await new Promise<void>((resolve, reject) => {
    pendingRows.push({
      row: rowOf(payload),
      settle: (error) => (error ? reject(error) : resolve()),
    });
    flushPending();
  });
}

async function store(payload: BenchPayload): Promise<void> {
  if (CH_URL) return insertRow(payload);
  if (STORE_MS > 0) await new Promise((resolve) => setTimeout(resolve, STORE_MS));
}

/** The Redis server's CPU and calls per command: on a private server, this run's alone. */
async function redisServerStats(redis: IORedis) {
  const info = (await redis.info("cpu")) + (await redis.info("commandstats"));
  const read = (pattern: RegExp) => Number(pattern.exec(info)?.[1] ?? 0);
  const calls = new Map<string, number>();
  for (const [, name, count] of info.matchAll(/cmdstat_(\w+):calls=(\d+)/g)) {
    calls.set(name!, Number(count));
  }
  return {
    cpuMs: (read(/used_cpu_sys:([\d.]+)/) + read(/used_cpu_user:([\d.]+)/)) * 1000,
    calls,
  };
}

const done: Record<Kind, number> = { command: 0, follow: 0, backlog: 0 };
const handlerMs: Record<Kind, number> = { command: 0, follow: 0, backlog: 0 };

async function main(): Promise<void> {
  const redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 0,
    enableAutoPipelining: process.env.BENCH_AUTO_PIPELINE === "1",
  });
  const runId = Math.random().toString(36).slice(2, 10);
  const queueName = `{bench/gq/${runId}}`;
  const context = new BenchContext();
  const queues: GroupQueueProcessor<BenchPayload>[] = [];
  const producer = () => queues[0]!;
  const hourAgo = Date.now() - 3_600_000;

  const handle = async (payload: BenchPayload): Promise<void> => {
    const started = performance.now();
    await store(payload);
    if (payload.kind === "command") {
      // As the projection router hands an event on: one batch per fold, one send per subscriber.
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
        const index = start + offset;
        const tenant = `bt${index % 500}`;
        return { kind: "backlog", tenant, group: `${tenant}/backlog/${index}`, at: hourAgo };
      }),
    );
  }
  const listed = makeQueue(true);
  await listed.waitUntilReady();
  sender.resume();

  const serverBefore = await redisServerStats(redis);
  const cpuBefore = process.cpuUsage();
  const eluBefore = performance.eventLoopUtilization();
  const running = (queue: GroupQueueProcessor<BenchPayload>): number =>
    (Reflect.get(queue, "processingQueue") as { running(): number }).running();
  const timeline: string[] = [];
  const sampler = setInterval(() => {
    timeline.push(`${running(listed)}/${running(sender)}:${done.command}/${done.follow}`);
  }, 1_000);
  const started = performance.now();
  let sendMs = 0;
  let roomMs = 0;
  await sender.runListedWork({
    name: `bench:${runId}`,
    timeoutMs: 120_000,
    work: async (list) => {
      for (let start = 0; start < USERS; start += PAGE) {
        const count = Math.min(PAGE, USERS - start);
        const now = Date.now();
        const sendStarted = performance.now();
        await sender.sendBatch(
          Array.from({ length: count }, (_, offset) => {
            const user = `u${start + offset}`;
            const tenant = LISTED_TENANTS > 0 ? `t${(start + offset) % LISTED_TENANTS}` : user;
            return { kind: "command", tenant, group: `${tenant}/command/${user}`, at: now };
          }),
        );
        const roomStarted = performance.now();
        sendMs += roomStarted - sendStarted;
        await list?.waitForRoom({ maxOutstanding: MAX_OUTSTANDING });
        roomMs += performance.now() - roomStarted;
      }
    },
  });
  const elapsedMs = performance.now() - started;
  const serverAfter = await redisServerStats(redis);
  clearInterval(sampler);
  const cpu = process.cpuUsage(cpuBefore);
  const elu = performance.eventLoopUtilization(eluBefore);

  const listedJobs = done.command + done.follow;
  const allJobs = listedJobs + done.backlog;
  const calls = [...serverAfter.calls.entries()]
    .map(([name, count]): [string, number] => [name, count - (serverBefore.calls.get(name) ?? 0)])
    .toSorted((a, b) => b[1] - a[1]);
  const totalCalls = calls.reduce((sum, [, count]) => sum + count, 0);
  const report = {
    shape: {
      USERS,
      PAGE,
      BACKLOG,
      FANOUT,
      LISTED_TENANTS,
      STORE_MS,
      CONCURRENCY,
      CH: Boolean(CH_URL),
      CH_POOL,
      CH_GROUP_COMMIT,
      CH_BUSY_MAX_MS,
    },
    elapsedS: +(elapsedMs / 1000).toFixed(2),
    listedJobsPerS: Math.round(listedJobs / (elapsedMs / 1000)),
    allJobsPerS: Math.round(allJobs / (elapsedMs / 1000)),
    usersPerMin: Math.round(done.command / (elapsedMs / 60_000)),
    done,
    avgHandlerMs: Object.fromEntries(
      (Object.keys(done) as Kind[]).map((kind) => [
        kind,
        done[kind] ? +(handlerMs[kind] / done[kind]).toFixed(2) : 0,
      ]),
    ),
    cpuMsPerJob: +((cpu.user + cpu.system) / 1000 / allJobs).toFixed(3),
    eventLoopUtilization: +elu.utilization.toFixed(3),
    pageSendMs: Math.round(sendMs),
    waitForRoomMs: Math.round(roomMs),
    redisServerCpuMsPerJob: +((serverAfter.cpuMs - serverBefore.cpuMs) / allJobs).toFixed(3),
    redisServerCpuShare: +((serverAfter.cpuMs - serverBefore.cpuMs) / elapsedMs).toFixed(3),
    redisServerCommandsPerJob: +(totalCalls / allJobs).toFixed(2),
    redisScriptCallsPerJob: +(
      calls
        .filter(([name]) => name === "evalsha" || name === "eval")
        .reduce((n, [, c]) => n + c, 0) / allJobs
    ).toFixed(2),
    redisTopCalls: Object.fromEntries(calls.slice(0, 6)),
    timeline: process.env.BENCH_TIMELINE ? timeline.join(" ") : undefined,
    chInserts,
    chInsertsPerJob: allJobs ? +(chInserts / allJobs).toFixed(2) : 0,
    chRowsPerInsert: chInserts ? +(chRows / chInserts).toFixed(1) : 0,
    chAvgInsertMs: chInserts ? +(chMs / chInserts).toFixed(1) : 0,
  };
  console.log(JSON.stringify(report, null, 2));

  await Promise.all(queues.map((queue) => queue.close()));
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${queueName}*`, "COUNT", 1000);
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== "0");
  await redis.srem("{gq-registry}:names", queueName);
  await redis.quit();
}

await main();
