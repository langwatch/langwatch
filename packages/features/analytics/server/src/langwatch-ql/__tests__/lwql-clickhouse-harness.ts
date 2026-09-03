/**
 * Test harness for the LangWatchQL analytics SQL isolation proof.
 *
 * Starts a ClickHouse container and applies the *shipped* provisioning from
 * `../provisioning` to it. The harness deliberately holds no copy of the
 * LangWatchQL DDL: a proof that runs its own transcription of the security
 * objects proves the transcription, not the thing we deploy.
 *
 * ## Why this suite always uses containers
 *
 * Every other ClickHouse integration suite honours the docker-free native mode
 * (`LANGWATCH_TEST_CLICKHOUSE_URL`, see `@langwatch/test-harness`). This one
 * cannot: the model depends on *server-level* configuration that only exists
 * if it is present at process start — `custom_settings_prefixes` (without it
 * the settings profile is rejected with UNKNOWN_SETTING 115) and access
 * management for the administrative user (without it none of the users,
 * profiles, policies or named collections can be created). A developer's
 * always-on ClickHouse has neither, and pointing this suite at it would both
 * fail and write security objects into a dev server.
 *
 * `startTestClickHouseEndpoints` is likewise not used: it provisions
 * per-organization endpoints for a different isolation model and has no way to
 * inject server config.
 *
 * ## The reused container holds whatever was applied LAST
 *
 * Every statement here is `OR REPLACE`, so a normal run converges the reused
 * container onto the current source. Two consequences worth knowing:
 *
 *  - Inspecting the container out of band shows the last run's provisioning,
 *    not the source you are reading. A container left behind by a deliberately
 *    broken run keeps the broken policy until the suite runs again — which is
 *    a good way to convince yourself of the opposite of what the code says.
 *  - `OR REPLACE` converges statements that still exist. A statement DELETED
 *    from the setup list leaves its object behind in a reused container, so
 *    the suite could pass on a policy the source no longer creates. Drop the
 *    containers (`docker rm -f $(docker ps -q --filter "label=langwatch.test=true")`)
 *    when changing which objects are provisioned, not just how.
 *
 * ## Scope of this port
 *
 * The `main` branch harness this was ported from also supports a `"migrated"`
 * fact-table mode — running the shipped ClickHouse migrations into a second
 * database and seeding the real `trace_summaries` / `stored_spans` /
 * `evaluation_runs` / `simulation_runs` tables — for suites that need real
 * partition pruning, dedup, or column types. That mode depends on the
 * migration runner (`migrateUp` in `@langwatch/clickhouse-client`), which is
 * not a public export of that package today, so it is not ported here: only
 * `facts: "fixture"` (the default, and everything the currently-ported
 * scenarios need) is implemented. `startLangWatchQLClickHouse` still accepts
 * the `facts` option so a future port can add the migrated branch without a
 * signature change.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseContainer, type StartedClickHouseContainer } from "@testcontainers/clickhouse";
import { TEST_CLICKHOUSE_IMAGE } from "@langwatch/test-harness";
import { expect } from "vitest";

import { lwqlTenantCapability } from "../capability";
import {
  CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH,
  CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH,
  CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML,
  clickHouseAccessManagementConfigXml,
  type LangWatchQLNames,
  type LangWatchQLTable,
  lwqlClickHouseSetupStatements,
} from "../provisioning";

/**
 * The administrative identity `@testcontainers/clickhouse` configures.
 *
 * Not `default`: the container sets `CLICKHOUSE_USER`, and the official image's
 * entrypoint then *removes* `default` and creates this user instead.
 */
const ADMIN_USER = "test";
const ADMIN_PASSWORD = "test";

/** Password of the restricted identity. Never leaves the harness. */
const RESTRICTED_PASSWORD = "lwql-reader-test-password";

/**
 * ClickHouse server error codes this proof discriminates between.
 *
 * Named because "it threw" is not an assertion: an UNKNOWN_TABLE from a typo in
 * the test would satisfy a bare rejection check and prove nothing.
 */
export const CLICKHOUSE_ERROR_CODE = {
  /** Correlated subquery shapes the engine has not implemented. */
  NOT_IMPLEMENTED: 48,
  /** A typo in the test, never a pass. */
  UNKNOWN_IDENTIFIER: 47,
  /** A typo in the test, never a pass. */
  UNKNOWN_TABLE: 60,
  SYNTAX_ERROR: 62,
  /** A setting change refused by `readonly = 1`. */
  READONLY: 164,
  /** Refused by grants. */
  ACCESS_DENIED: 497,
} as const;

/**
 * A tenant, its LangWatchQL secret, and the hash that is all ClickHouse ever
 * sees.
 *
 * The secret stands in for `Project.lwqlKey`, never for a credential a
 * caller authenticates with: the capability names a tenant, and the two values
 * rotate independently (see `../capability.ts`).
 */
export interface LangWatchQLTenantFixture {
  tenantId: string;
  /**
   * The raw secret. Deliberately long and distinctive so an audit assertion
   * that it never reached the server cannot pass by accident on a short
   * substring.
   */
  rawSecret: string;
  /** `sha256(rawSecret)`, the only form that travels to ClickHouse. */
  keyHash: string;
}

function tenantFixture(tenantId: string, rawSecret: string): LangWatchQLTenantFixture {
  return {
    tenantId,
    rawSecret,
    // Derived through the production function rather than re-hashed here: the
    // key map only resolves a tenant when the two agree, and a fixture with its
    // own copy of the algorithm would drift into seeding a digest production
    // never computes — surfacing as every LangWatchQL read returning zero rows,
    // which is indistinguishable from a tenant that simply has no data.
    keyHash: lwqlTenantCapability({ secret: rawSecret }),
  };
}

export const TENANT_A = tenantFixture("tenant-a", "raw-lwql-key-DO-NOT-LOG-abcdef123456");
export const TENANT_B = tenantFixture("tenant-b", "raw-lwql-key-VICTIM-DO-NOT-LOG-fedcba654321");

/** The seeded fact tables. Fixtures — the real ones come from migrations. */
const FACT_TABLE_DDL: Record<string, string> = {
  traces:
    "(TenantId String, TraceId String, Model String, Latency UInt32) " +
    "ENGINE = MergeTree ORDER BY (TenantId, TraceId)",
  spans:
    "(TenantId String, TraceId String, SpanId String, Name String) " +
    "ENGINE = MergeTree ORDER BY (TenantId, TraceId, SpanId)",
};

/** The LangWatchQL fact tables and the column each row policy filters on. */
export const LWQL_FACT_TABLES: LangWatchQLTable[] = [
  { table: "traces", tenantColumn: "TenantId" },
  { table: "spans", tenantColumn: "TenantId" },
];

/**
 * Where the fact tables the proof reads come from.
 *
 * `fixture` is two toy `MergeTree` tables created by this harness — enough to
 * prove row policies, grants and settings behave, and deliberately unlike the
 * real schema so nothing about the real schema can be inferred from it passing.
 *
 * `migrated` is not yet ported — see the module comment.
 */
export type LangWatchQLFactTableMode = "fixture" | "migrated";

export interface LangWatchQLClickHouseHarness {
  names: LangWatchQLNames;
  /** Administrative client. Reads `system.*`, seeds fixtures, runs audits. */
  admin: ClickHouseClient;
  tenantA: LangWatchQLTenantFixture;
  tenantB: LangWatchQLTenantFixture;
  lwqlTables: LangWatchQLTable[];
  /** Database holding the fact tables the LangWatchQL views read. */
  factDatabase: string;
  /**
   * A client authenticated as the restricted identity.
   *
   * Omitting `keyHash` sends NO tenant setting at all, which is the path that
   * exercises the profile default. Passing `""` sends an explicit empty one.
   * The two are different requests and the proof pins both.
   *
   * Asserts `currentUser()` before returning, so no isolation assertion can
   * accidentally run as the administrator.
   */
  restrictedClient(options?: { keyHash?: string }): Promise<ClickHouseClient>;
  /**
   * The restricted identity's credentials, for a caller that must build its own
   * client rather than borrow one — the REST endpoint suite, which drives the
   * shipped executor and therefore needs a connection, not a connection object
   * someone else opened.
   */
  restrictedConnection(): {
    url: string;
    username: string;
    password: string;
  };
  /** Runs statements as the administrator, in order. */
  applyAsAdmin(statements: string[]): Promise<void>;
  container: StartedClickHouseContainer;
  stop(): Promise<void>;
}

/**
 * Names every object this suite creates, derived from the caller's suite name.
 *
 * Per-suite rather than shared: users, profiles and row policies are
 * server-global in ClickHouse, so two suites sharing a reused container would
 * otherwise mutate each other's security objects.
 */
export function lwqlNamesForSuite(suite: string): LangWatchQLNames {
  const slug = suite.replace(/[^a-zA-Z0-9_]/g, "_");
  return {
    database: `lwql_${slug}`,
    restrictedUser: `lwql_${slug}_reader`,
    settingsProfile: `lwql_${slug}_profile`,
    keyMapTable: "api_key_tenants",
    tenantSetting: "custom_api_key_hash",
  };
}

function writeConfigFile(directory: string, name: string, contents: string): string {
  const path = join(directory, name);
  writeFileSync(path, contents);
  return path;
}

/**
 * Starts ClickHouse with the server-level prerequisites installed, then applies
 * the shipped provisioning and seeds two tenants' rows.
 */
export async function startLangWatchQLClickHouse({
  suite,
  facts = "fixture",
}: {
  suite: string;
  facts?: LangWatchQLFactTableMode;
}): Promise<LangWatchQLClickHouseHarness> {
  if (facts === "migrated") {
    throw new Error(
      "startLangWatchQLClickHouse({ facts: 'migrated' }) is not yet ported — see the module comment in lwql-clickhouse-harness.ts",
    );
  }

  const names = lwqlNamesForSuite(suite);
  const accessManagementXml = clickHouseAccessManagementConfigXml({
    administrativeUser: ADMIN_USER,
  });
  const configDigest = createHash("sha256")
    .update(CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML)
    .update(accessManagementXml)
    .digest("hex")
    .slice(0, 16);

  const configDirectory = mkdtempSync(join(tmpdir(), "lwql-config-"));
  const container = await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
    .withUsername(ADMIN_USER)
    .withPassword(ADMIN_PASSWORD)
    .withLabels({
      "langwatch.test": "true",
      "langwatch.test.type": "integration",
      // File copies are not part of the reuse hash; labels are. Without this a
      // changed XML keeps reusing a container running the previous config.
      "langwatch.test.lwql.config": configDigest,
    })
    .withCopyFilesToContainer([
      {
        source: writeConfigFile(
          configDirectory,
          "custom-settings-prefix.xml",
          CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML,
        ),
        target: CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH,
      },
      {
        source: writeConfigFile(configDirectory, "access-management.xml", accessManagementXml),
        target: CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH,
      },
    ])
    .withReuse()
    .withStartupTimeout(120_000)
    .start();

  const httpUrl = container.getHttpUrl();
  const admin = createClient({
    url: httpUrl,
    username: ADMIN_USER,
    password: ADMIN_PASSWORD,
  });

  const openedClients: ClickHouseClient[] = [];

  const applyAsAdmin = async (statements: string[]): Promise<void> => {
    for (const query of statements) {
      await admin.command({ query });
    }
  };

  // A reused container carries the previous run's objects. Dropping the
  // database first makes every run start from the same state, so a test that
  // creates a fixture object cannot leak into the next run's audits.
  await applyAsAdmin([`DROP DATABASE IF EXISTS ${names.database}`]);
  await applyAsAdmin([`CREATE DATABASE ${names.database}`]);

  const factDatabase = names.database;
  const lwqlTables = LWQL_FACT_TABLES;

  await applyAsAdmin(
    Object.entries(FACT_TABLE_DDL).map(
      ([table, ddl]) => `CREATE TABLE ${names.database}.${table} ${ddl}`,
    ),
  );

  await applyAsAdmin(
    lwqlClickHouseSetupStatements({
      names,
      password: RESTRICTED_PASSWORD,
      lwqlTables,
    }),
  );

  await seedKeyMap({ admin, names });
  await seedTenantRows({ admin, names });

  const harness: LangWatchQLClickHouseHarness = {
    names,
    admin,
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    lwqlTables,
    factDatabase,
    container,
    applyAsAdmin,
    async restrictedClient(options) {
      const keyHash = options?.keyHash;
      const client = createClient({
        url: httpUrl,
        username: names.restrictedUser,
        password: RESTRICTED_PASSWORD,
        ...(keyHash === undefined
          ? {}
          : { clickhouse_settings: { [names.tenantSetting]: keyHash } }),
      });
      openedClients.push(client);
      await expectRestrictedIdentity({ client, names });
      return client;
    },
    restrictedConnection() {
      return {
        url: httpUrl,
        username: names.restrictedUser,
        password: RESTRICTED_PASSWORD,
      };
    },
    async stop() {
      await Promise.all(openedClients.map((client) => client.close()));
      await admin.close();
      // Reusable containers are deliberately left running, as globalSetup does.
    },
  };
  return harness;
}

/** One live key-map entry per tenant. */
async function seedKeyMap({
  admin,
  names,
}: {
  admin: ClickHouseClient;
  names: LangWatchQLNames;
}): Promise<void> {
  await admin.insert({
    table: `${names.database}.${names.keyMapTable}`,
    format: "JSONEachRow",
    values: [TENANT_A, TENANT_B].map((tenant) => ({
      KeyHash: tenant.keyHash,
      TenantId: tenant.tenantId,
    })),
  });
}

/** Two tenants, each with rows in every fixture fact table. */
async function seedTenantRows({
  admin,
  names,
}: {
  admin: ClickHouseClient;
  names: LangWatchQLNames;
}): Promise<void> {
  await admin.insert({
    table: `${names.database}.traces`,
    format: "JSONEachRow",
    values: [TENANT_A, TENANT_B].flatMap((tenant) =>
      [1, 2].map((index) => ({
        TenantId: tenant.tenantId,
        TraceId: `${tenant.tenantId}-trace-${index}`,
        Model: "gpt-5-mini",
        Latency: 100 * index,
      })),
    ),
  });
  await admin.insert({
    table: `${names.database}.spans`,
    format: "JSONEachRow",
    values: [TENANT_A, TENANT_B].flatMap((tenant) =>
      [1, 2].map((index) => ({
        TenantId: tenant.tenantId,
        TraceId: `${tenant.tenantId}-trace-${index}`,
        SpanId: `${tenant.tenantId}-span-${index}`,
        Name: "llm.call",
      })),
    ),
  });
}

// ---------------------------------------------------------------------------
// Query measurement
// ---------------------------------------------------------------------------

export interface LangWatchQLQueryMeasurement {
  /** Physical rows read off the parts — what partition pruning changes. */
  rowsRead: number;
  bytesRead: number;
  resultRows: number;
  durationMs: number;
}

/**
 * Runs a query and reads its cost out of `system.query_log`.
 *
 * The server's own accounting rather than a wall-clock timer around the call:
 * an HTTP round trip on a laptop is noise next to the number under measurement,
 * and `read_rows` is the one that says whether a predicate reached the read.
 */
export async function measureQuery({
  harness,
  client,
  query,
}: {
  harness: LangWatchQLClickHouseHarness;
  client: ClickHouseClient;
  query: string;
}): Promise<LangWatchQLQueryMeasurement> {
  const queryId = `lwql-measure-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await selectRows(client, query, { query_id: queryId });
  await harness.applyAsAdmin(["SYSTEM FLUSH LOGS"]);

  const entries = await selectRows<{
    read_rows: string;
    read_bytes: string;
    result_rows: string;
    query_duration_ms: string;
  }>(
    harness.admin,
    `SELECT read_rows, read_bytes, result_rows, query_duration_ms ` +
      `FROM system.query_log WHERE query_id = '${queryId}' AND type = 'QueryFinish'`,
  );
  const entry = entries[0];
  expect(
    entry,
    `no query_log entry for the measured query — the numbers below would be invented`,
  ).toBeDefined();
  return {
    rowsRead: Number(entry!.read_rows),
    bytesRead: Number(entry!.read_bytes),
    resultRows: Number(entry!.result_rows),
    durationMs: Number(entry!.query_duration_ms),
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/** Runs a SELECT and returns its rows. */
export async function selectRows<T>(
  client: ClickHouseClient,
  query: string,
  options?: { query_id?: string },
): Promise<T[]> {
  const result = await client.query({
    query,
    format: "JSONEachRow",
    ...(options?.query_id ? { query_id: options.query_id } : {}),
  });
  return await result.json<T>();
}

/** Runs a SELECT expected to return exactly one scalar column named `value`. */
export async function selectScalar<T>(client: ClickHouseClient, query: string): Promise<T> {
  const rows = await selectRows<{ value: T }>(client, query);
  expect(rows, `expected exactly one row from: ${query}`).toHaveLength(1);
  return rows[0]!.value;
}

/**
 * Asserts the client is the restricted identity.
 *
 * Every isolation claim in this suite is conditional on *who* ran the query, so
 * this runs before the claim rather than being assumed from the credentials
 * that were passed.
 */
export async function expectRestrictedIdentity({
  client,
  names,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
}): Promise<void> {
  const currentUser = await selectScalar<string>(client, "SELECT currentUser() AS value");
  expect(currentUser, "queries in this suite must execute as the restricted identity").toBe(
    names.restrictedUser,
  );
}

/**
 * Pulls ClickHouse's numeric error code out of a thrown error.
 *
 * `@clickhouse/client` throws a `ClickHouseError` carrying `code` (the number as
 * a string) and `type` (the symbolic name) as properties, having already
 * stripped the `Code: 497. DB::Exception:` prefix from the message — so reading
 * the property is the reliable path and the message regex is only a fallback for
 * errors that arrive as raw HTTP text.
 */
function clickHouseErrorCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  if (typeof code === "number") return code;
  const message = error instanceof Error ? error.message : String(error);
  const match = /Code:\s*(\d+)/.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * Asserts a statement is rejected with one specific ClickHouse error code.
 *
 * Fails when the statement succeeds, when no code can be parsed (a connection
 * failure is not a rejection), and — the point of the helper — when the code is
 * any code other than the expected one. A typo yielding UNKNOWN_TABLE must turn
 * the test red rather than read as a successful denial.
 */
export async function expectClickHouseError(
  run: () => Promise<unknown>,
  expectedCode: (typeof CLICKHOUSE_ERROR_CODE)[keyof typeof CLICKHOUSE_ERROR_CODE],
  context: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `${context}: expected a rejection, the statement succeeded`).toBeDefined();
  const code = clickHouseErrorCode(thrown);
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  expect(code, `${context}: no ClickHouse error code in "${message}"`).not.toBeNull();
  expect(code, `${context}: wrong rejection — "${message}"`).toBe(expectedCode);
}

/** Runs a statement that is expected to be refused, without reading a result. */
export function runStatement(client: ClickHouseClient, query: string): () => Promise<unknown> {
  return async () => {
    const { stream } = await client.exec({ query });
    stream.destroy();
  };
}

/** Admin-visible row counts per tenant: the control behind every zero-rows claim. */
export interface SeedControl {
  tenantA: number;
  tenantB: number;
}

/**
 * Records how many rows each tenant actually has, and fails if either is zero.
 *
 * Every "no foreign rows were returned" assertion in this suite is an absence
 * check, and an absence check passes against an empty database. Pairing it with
 * this control is what makes it mean something: a control that is itself zero
 * fails the test instead of quietly certifying nothing.
 */
export async function recordSeedControl({
  harness,
  table,
  tenantColumn,
  database,
}: {
  harness: LangWatchQLClickHouseHarness;
  table: string;
  tenantColumn: string;
  /** Defaults to the LangWatchQL database; the migrated facts live elsewhere. */
  database?: string;
}): Promise<SeedControl> {
  const rows = await selectRows<{ tenant: string; row_count: string }>(
    harness.admin,
    `SELECT ${tenantColumn} AS tenant, count() AS row_count ` +
      `FROM ${database ?? harness.names.database}.${table} GROUP BY tenant`,
  );
  const countFor = (tenantId: string): number =>
    Number(rows.find((row) => row.tenant === tenantId)?.row_count ?? 0);

  const control: SeedControl = {
    tenantA: countFor(harness.tenantA.tenantId),
    tenantB: countFor(harness.tenantB.tenantId),
  };
  expect(
    control.tenantA,
    `${table} holds no ${harness.tenantA.tenantId} rows — every isolation assertion over it would be vacuous`,
  ).toBeGreaterThan(0);
  expect(
    control.tenantB,
    `${table} holds no ${harness.tenantB.tenantId} rows — "no foreign rows returned" would be vacuous`,
  ).toBeGreaterThan(0);
  return control;
}

/**
 * Asserts a restricted read returned rows, all of them the caller's tenant's.
 *
 * Non-emptiness is part of the assertion: "every returned row belongs to
 * tenant-a" is trivially true of no rows at all.
 */
export function expectOnlyTenantA<T extends Record<string, unknown>>({
  rows,
  tenantColumn,
  harness,
  context,
}: {
  rows: T[];
  tenantColumn: string;
  harness: LangWatchQLClickHouseHarness;
  context: string;
}): void {
  expect(rows.length, `${context}: read returned nothing to check`).toBeGreaterThan(0);
  const tenants = [...new Set(rows.map((row) => String(row[tenantColumn])))];
  expect(tenants, `${context}: foreign tenant rows were returned`).toEqual([
    harness.tenantA.tenantId,
  ]);
}

/**
 * The whole shape of a scoped read, in one call: control first, then the claim.
 *
 * Reads `query` as the restricted identity with tenant-a's key, having first
 * proved through the administrator that both tenants have rows in `table`, and
 * asserts the read saw exactly tenant-a's.
 */
export async function expectTenantScopedRead({
  harness,
  client,
  query,
  table,
  tenantColumn,
  resultTenantColumn = tenantColumn,
  context,
}: {
  harness: LangWatchQLClickHouseHarness;
  client: ClickHouseClient;
  query: string;
  table: string;
  tenantColumn: string;
  resultTenantColumn?: string;
  context: string;
}): Promise<void> {
  await recordSeedControl({ harness, table, tenantColumn });
  const rows = await selectRows<Record<string, unknown>>(client, query);
  expectOnlyTenantA({
    rows,
    tenantColumn: resultTenantColumn,
    harness,
    context,
  });
}

/**
 * Asserts a key context reads nothing while the data it would reach exists.
 *
 * Zero rows is only evidence of a working policy if there were rows to miss.
 */
export async function expectZeroRowsWithControl({
  harness,
  keyHash,
  table,
  tenantColumn,
  context,
}: {
  harness: LangWatchQLClickHouseHarness;
  keyHash?: string;
  table: string;
  tenantColumn: string;
  context: string;
}): Promise<void> {
  const control = await recordSeedControl({ harness, table, tenantColumn });
  const client = await harness.restrictedClient(keyHash === undefined ? {} : { keyHash });
  const rows = await selectRows<Record<string, unknown>>(
    client,
    `SELECT * FROM ${harness.names.database}.${table}`,
  );
  expect(
    rows,
    `${context}: expected zero rows while ${control.tenantA + control.tenantB} rows exist`,
  ).toHaveLength(0);
}
