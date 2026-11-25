import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { nowInstant } from "@langwatch/time";

import { DEFAULT_LOG_LEVEL, redisLogLevel } from "../shared/log-level.ts";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { execCheck, pollUntilHealthy } from "./health.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

export async function startRedis(ctx: RuntimeContext, bus: EventBus): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "redis" });
  const start = nowInstant().epochMilliseconds;

  const resolvedPath = ctx.predeps.redis?.resolvedPath;
  if (!resolvedPath) throw new Error("redis predep not resolved — run install first");
  const sp = servicePaths(ctx.paths);
  const conf = sp.redisConf;

  // Always regenerate — same reasoning as clickhouse.ts: ports + dataDir
  // are pure functions of ctx, and skipping when the file exists baked
  // the FIRST run's port into redis.conf forever, which auto-port-shift
  // on subsequent runs would leave stale.
  writeRedisConf({
    path: conf,
    port: ctx.ports.redis,
    dataDir: ctx.paths.redisData,
    logLevel: ctx.logLevel ?? DEFAULT_LOG_LEVEL,
  });

  const handle = supervise({
    spec: {
      name: "redis",
      command: resolvedPath,
      args: [conf],
      env: process.env,
    },
    paths: sp,
    bus,
  });

  const redisCli = resolvedPath.replace(/redis-server$/, "redis-cli");
  const ready = await pollUntilHealthy({
    handle,
    check: execCheck(redisCli, ["-h", "127.0.0.1", "-p", String(ctx.ports.redis), "ping"], {
      expectStdoutContains: "PONG",
    }),
    timeoutMs: 10_000,
    intervalMs: 200,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`redis did not become ready: ${ready.reason}`);
  }

  bus.emit({
    type: "healthy",
    service: "redis",
    durationMs: nowInstant().epochMilliseconds - start,
  });
  return handle;
}

function writeRedisConf({
  path,
  port,
  dataDir,
  logLevel,
}: {
  path: string;
  port: number;
  dataDir: string;
  logLevel: string;
}): void {
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const lines = [
    `port ${port}`,
    "bind 127.0.0.1",
    `dir ${dataDir}`,
    "appendonly yes",
    "appendfsync everysec",
    "save 900 1",
    "save 300 10",
    "save 60 10000",
    `loglevel ${redisLogLevel(logLevel)}`,
    "maxmemory-policy allkeys-lru",
    "",
  ];
  writeFileSync(path, lines.join("\n"));
}
