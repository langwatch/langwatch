/**
 * Shared Redis for this package's integration suite. Mirrors
 * packages/clickhouse/src/__tests__/integration/testClickHouse.ts: an
 * always-on native Redis when `LANGWATCH_TEST_REDIS_URL` is set (never in
 * CI), a disposable `.withReuse()` container otherwise. Isolation between
 * tests is by unique lane and tenant ids, not by database — every key this
 * package writes is scoped to a caller-chosen tenant/lane already.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  RedisContainer,
  type StartedRedisContainer,
} from "@testcontainers/redis";

const CONTAINER_INFO_FILE = path.join(
  os.tmpdir(),
  "langwatch-groupqueue-pkg-test-redis.json",
);

export interface TestRedisInfo {
  readonly url: string;
}

export function nativeRedisBaseUrl(): string | null {
  if (process.env.CI) return null;
  return process.env.LANGWATCH_TEST_REDIS_URL ?? null;
}

export async function startTestRedis(): Promise<TestRedisInfo> {
  const url = nativeRedisBaseUrl() ?? (await startContainer());
  return { url };
}

async function startContainer(): Promise<string> {
  const container: StartedRedisContainer = await new RedisContainer(
    "redis:7.4-alpine",
  )
    .withLabels({
      "langwatch.test": "true",
      "langwatch.test.groupqueue-pkg": "true",
    })
    .withReuse()
    .withStartupTimeout(120_000)
    .start();
  return container.getConnectionUrl();
}

export function readTestRedisInfo(): TestRedisInfo {
  const raw = fs.readFileSync(CONTAINER_INFO_FILE, "utf-8");
  return JSON.parse(raw) as TestRedisInfo;
}

export function writeTestRedisInfo(info: TestRedisInfo): void {
  fs.writeFileSync(CONTAINER_INFO_FILE, JSON.stringify(info));
}

export function uniqueTenant(): string {
  return `test-tenant-${randomUUID()}`;
}

export function uniqueLaneName(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
