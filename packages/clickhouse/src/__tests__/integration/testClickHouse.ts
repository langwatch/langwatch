/**
 * Shared infrastructure for this package's integration suite: one ClickHouse
 * instance and one database for the whole run, isolation by unique tenant and
 * entity ids rather than a database per test.
 *
 * A fresh database per test would serialise the suite behind ClickHouse DDL —
 * every `CREATE DATABASE` contends for the same DDL queue as every other
 * statement, and on a `Replicated` engine that queue is the slowest thing
 * ClickHouse offers: a DDL statement round-trips through every replica before
 * it returns, where a row insert does not. Generating a unique tenant id per
 * test costs nothing at call time and gives the same guarantee — no two tests
 * can observe each other's rows, because every query in this suite starts
 * with `TenantId = {tenantId:String}`, the same predicate production code is
 * required to lead with (CLAUDE.md, "Writing ClickHouse queries without
 * TenantId filtering").
 *
 * Mirrors the native-vs-container decision in
 * `langwatch/src/test-utils/clickhouseTestEndpoints.ts`: an always-on local
 * ClickHouse when `LANGWATCH_TEST_CLICKHOUSE_URL` is set (never in CI), a
 * disposable `.withReuse()` container otherwise. This package cannot import
 * that module directly — it is application code, and this package's whole
 * reason for existing is to carry no dependency on the application — so the
 * same decision is restated here against this package's own dedicated test
 * database.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createClient } from "@clickhouse/client";
import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";

/** Pinned to the same image the application's own integration suite uses. */
export const TEST_CLICKHOUSE_IMAGE = "clickhouse/clickhouse-server:25.10.2.65";

const TEST_DATABASE = "test_langwatch_clickhouse_pkg";

const CONTAINER_INFO_FILE = path.join(
  os.tmpdir(),
  "langwatch-clickhouse-pkg-test-container.json",
);

export interface TestClickHouseInfo {
  readonly url: string;
}

/**
 * The always-on local ClickHouse the docker-free test mode runs against, or
 * null when the caller should fall back to a container. Never active in CI.
 */
export function nativeClickHouseBaseUrl(): string | null {
  if (process.env.CI) return null;
  return process.env.LANGWATCH_TEST_CLICKHOUSE_URL ?? null;
}

/**
 * Starts (or reuses) the ClickHouse this run targets and returns a URL
 * pointing at this package's own dedicated database. Called once, from
 * `globalSetup.ts` — every test file reads the result back via
 * {@link readTestClickHouseInfo} instead of calling this again.
 */
export async function startTestClickHouse(): Promise<TestClickHouseInfo> {
  const baseUrl = nativeClickHouseBaseUrl() ?? (await startContainer());
  const url = await ensureTestDatabase(baseUrl);
  return { url };
}

async function startContainer(): Promise<string> {
  const container: StartedClickHouseContainer = await new ClickHouseContainer(
    TEST_CLICKHOUSE_IMAGE,
  )
    .withLabels({
      "langwatch.test": "true",
      "langwatch.test.clickhouse-pkg": "true",
    })
    .withReuse()
    .withStartupTimeout(120_000)
    .start();
  return container.getConnectionUrl();
}

/**
 * Creates this package's dedicated database if absent and returns the URL
 * that selects it. `CREATE DATABASE` goes to the server root rather than the
 * endpoint URL: the database does not exist yet on a first run, and
 * connecting to a missing one fails before the statement is ever sent.
 */
async function ensureTestDatabase(baseUrl: string): Promise<string> {
  const root = createClient({ url: rootUrl(baseUrl) });
  try {
    await root.command({
      query: "CREATE DATABASE IF NOT EXISTS {database:Identifier}",
      query_params: { database: TEST_DATABASE },
    });
  } finally {
    await root.close();
  }
  return endpointUrl(baseUrl, TEST_DATABASE);
}

function rootUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/";
  return url.toString();
}

function endpointUrl(baseUrl: string, database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Hands the URL `globalSetup.ts` resolved to each test file. `globalSetup`
 * runs once, in a process separate from the worker(s) that execute test
 * files, so the two can only agree on a connection URL through a shared
 * file — the same bridge `langwatch/vitest.integration.config.ts`'s own
 * globalSetup uses for the same reason.
 */
export function readTestClickHouseInfo(): TestClickHouseInfo {
  const raw = fs.readFileSync(CONTAINER_INFO_FILE, "utf-8");
  return JSON.parse(raw) as TestClickHouseInfo;
}

export function writeTestClickHouseInfo(info: TestClickHouseInfo): void {
  fs.writeFileSync(CONTAINER_INFO_FILE, JSON.stringify(info));
}

/**
 * One tenant id per test. Every predicate in this suite is scoped to it, so
 * two tests sharing the same tables — created once, per {@link
 * ../fixtures.ts} — never observe each other's rows regardless of execution
 * order.
 */
export function uniqueTenant(): string {
  return `test-tenant-${randomUUID()}`;
}

/** A unique entity id, prefixed for readability when a query fails. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
