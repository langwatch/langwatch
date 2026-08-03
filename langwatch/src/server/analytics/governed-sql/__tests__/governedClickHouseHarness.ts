/**
 * Test harness for the governed analytics SQL isolation proof.
 *
 * Starts a ClickHouse container (and, on request, a PostgreSQL container) and
 * applies the *shipped* provisioning from `../provisioning` to it. The harness
 * deliberately holds no copy of the governed DDL: a proof that runs its own
 * transcription of the security objects proves the transcription, not the thing
 * we deploy.
 *
 * ## Why this suite always uses containers
 *
 * Every other ClickHouse integration suite honours the docker-free native mode
 * (`LANGWATCH_TEST_CLICKHOUSE_URL`, see `~/test-utils/clickhouseTestEndpoints`).
 * This one cannot: the model depends on *server-level* configuration that only
 * exists if it is present at process start —
 * `custom_settings_prefixes` (without it the settings profile is rejected with
 * UNKNOWN_SETTING 115) and access management for the administrative user
 * (without it none of the users, profiles, policies or named collections can be
 * created). A developer's always-on ClickHouse has neither, and pointing this
 * suite at it would both fail and write security objects into a dev server.
 *
 * `startTestClickHouseEndpoints` is likewise not used: it provisions
 * per-organization endpoints for a different isolation model and has no way to
 * inject server config.
 *
 * ## Why the containers do not share a docker network
 *
 * ClickHouse reaches PostgreSQL through `host.docker.internal` (mapped to
 * `host-gateway`) and PostgreSQL's published port, rather than a testcontainers
 * `Network` with a container alias. Reuse forces this: the reuse hash is
 * computed from the container's *create* options only, while the network
 * attachment lives in the host config, so a REUSED container is never
 * re-attached to the new run's network — it stays on the previous run's,
 * which has since been removed. `withNetwork` plus `withReuse` therefore
 * strands ClickHouse on a dead network on the second run. An extra host is
 * stable across runs and needs no cleanup.
 *
 * Container labels match `globalSetup.ts`, so the documented sweep
 * (`docker rm -f $(docker ps -q --filter "label=langwatch.test=true")`) reaps
 * these too. The server config is digested into a further label because file
 * copies are NOT part of the reuse hash — without it, editing the XML would
 * silently keep reusing a container running the old configuration.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { expect } from "vitest";
import { TEST_CLICKHOUSE_IMAGE } from "~/test-utils/clickhouseTestEndpoints";
import {
  CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH,
  CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH,
  CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML,
  clickHouseAccessManagementConfigXml,
  type GovernedSqlNames,
  type GovernedTable,
  governedClickHouseSetupStatements,
  governedGrantStatement,
  governedRowPolicyStatement,
  postgresEngineTableStatement,
  postgresNamedCollectionStatements,
  postgresReaderRoleStatements,
} from "../provisioning";

/** PostgreSQL image the PG-engine half of the proof runs against. */
export const TEST_POSTGRES_IMAGE = "postgres:17";

/**
 * The administrative identity `@testcontainers/clickhouse` configures.
 *
 * Not `default`: the container sets `CLICKHOUSE_USER`, and the official image's
 * entrypoint then *removes* `default` and creates this user instead.
 */
const ADMIN_USER = "test";
const ADMIN_PASSWORD = "test";

/** Password of the restricted identity. Never leaves the harness. */
const RESTRICTED_PASSWORD = "governed-reader-test-password";

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

/** PostgreSQL SQLSTATEs this proof discriminates between. */
export const POSTGRES_SQLSTATE = {
  READ_ONLY_TRANSACTION: "25006",
  INSUFFICIENT_PRIVILEGE: "42501",
} as const;

/** A tenant, its API key, and the hash that is all ClickHouse ever sees. */
export interface GovernedTenantFixture {
  tenantId: string;
  /**
   * The raw key. Deliberately long and distinctive so an audit assertion that
   * it never reached the server cannot pass by accident on a short substring.
   */
  rawApiKey: string;
  /** `sha256(rawApiKey)`, the only form that travels to ClickHouse. */
  keyHash: string;
}

function tenantFixture(tenantId: string, rawApiKey: string): GovernedTenantFixture {
  return {
    tenantId,
    rawApiKey,
    keyHash: createHash("sha256").update(rawApiKey).digest("hex"),
  };
}

export const TENANT_A = tenantFixture(
  "tenant-a",
  "raw-api-key-DO-NOT-LOG-abcdef123456",
);
export const TENANT_B = tenantFixture(
  "tenant-b",
  "raw-api-key-VICTIM-DO-NOT-LOG-fedcba654321",
);

/** The seeded fact tables. Fixtures — the real ones come from migrations. */
const FACT_TABLE_DDL: Record<string, string> = {
  traces:
    "(TenantId String, TraceId String, Model String, Latency UInt32) " +
    "ENGINE = MergeTree ORDER BY (TenantId, TraceId)",
  spans:
    "(TenantId String, TraceId String, SpanId String, Name String) " +
    "ENGINE = MergeTree ORDER BY (TenantId, TraceId, SpanId)",
};

/** The governed fact tables and the column each row policy filters on. */
export const GOVERNED_FACT_TABLES: GovernedTable[] = [
  { table: "traces", tenantColumn: "TenantId" },
  { table: "spans", tenantColumn: "TenantId" },
];

export interface GovernedClickHouseHarness {
  names: GovernedSqlNames;
  /** Administrative client. Reads `system.*`, seeds fixtures, runs audits. */
  admin: ClickHouseClient;
  tenantA: GovernedTenantFixture;
  tenantB: GovernedTenantFixture;
  governedTables: GovernedTable[];
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
export function governedNamesForSuite(suite: string): GovernedSqlNames {
  const slug = suite.replace(/[^a-zA-Z0-9_]/g, "_");
  return {
    database: `governed_${slug}`,
    restrictedUser: `governed_${slug}_reader`,
    settingsProfile: `governed_${slug}_profile`,
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
export async function startGovernedClickHouse({
  suite,
}: {
  suite: string;
}): Promise<GovernedClickHouseHarness> {
  const names = governedNamesForSuite(suite);
  const accessManagementXml = clickHouseAccessManagementConfigXml({
    administrativeUser: ADMIN_USER,
  });
  const configDigest = createHash("sha256")
    .update(CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML)
    .update(accessManagementXml)
    .digest("hex")
    .slice(0, 16);

  const configDirectory = mkdtempSync(join(tmpdir(), "governed-sql-config-"));
  const container = await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
    .withUsername(ADMIN_USER)
    .withPassword(ADMIN_PASSWORD)
    .withLabels({
      "langwatch.test": "true",
      "langwatch.test.type": "integration",
      // File copies are not part of the reuse hash; labels are. Without this a
      // changed XML keeps reusing a container running the previous config.
      "langwatch.test.governed-sql.config": configDigest,
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
        source: writeConfigFile(
          configDirectory,
          "access-management.xml",
          accessManagementXml,
        ),
        target: CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH,
      },
    ])
    // Reaching PostgreSQL on the docker host; see the module comment.
    .withExtraHosts([
      { host: "host.docker.internal", ipAddress: "host-gateway" },
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
  await applyAsAdmin(
    Object.entries(FACT_TABLE_DDL).map(
      ([table, ddl]) => `CREATE TABLE ${names.database}.${table} ${ddl}`,
    ),
  );
  await applyAsAdmin(
    governedClickHouseSetupStatements({
      names,
      password: RESTRICTED_PASSWORD,
      governedTables: GOVERNED_FACT_TABLES,
    }),
  );
  await seedTenantRows({ admin, names });

  const harness: GovernedClickHouseHarness = {
    names,
    admin,
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    governedTables: GOVERNED_FACT_TABLES,
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
    async stop() {
      await Promise.all(openedClients.map((client) => client.close()));
      await admin.close();
      // Reusable containers are deliberately left running, as globalSetup does.
    },
  };
  return harness;
}

/** Two tenants, each with rows in every fact table and a live key-map entry. */
async function seedTenantRows({
  admin,
  names,
}: {
  admin: ClickHouseClient;
  names: GovernedSqlNames;
}): Promise<void> {
  await admin.insert({
    table: `${names.database}.${names.keyMapTable}`,
    format: "JSONEachRow",
    values: [TENANT_A, TENANT_B].map((tenant) => ({
      KeyHash: tenant.keyHash,
      TenantId: tenant.tenantId,
    })),
  });
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
export async function selectScalar<T>(
  client: ClickHouseClient,
  query: string,
): Promise<T> {
  const rows = await selectRows<{ value: T }>(client, query);
  expect(
    rows,
    `expected exactly one row from: ${query}`,
  ).toHaveLength(1);
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
  names: GovernedSqlNames;
}): Promise<void> {
  const currentUser = await selectScalar<string>(
    client,
    "SELECT currentUser() AS value",
  );
  expect(
    currentUser,
    "queries in this suite must execute as the restricted identity",
  ).toBe(names.restrictedUser);
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
  expect(
    code,
    `${context}: no ClickHouse error code in "${message}"`,
  ).not.toBeNull();
  expect(code, `${context}: wrong rejection — "${message}"`).toBe(expectedCode);
}

/** Runs a statement that is expected to be refused, without reading a result. */
export function runStatement(
  client: ClickHouseClient,
  query: string,
): () => Promise<unknown> {
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
}: {
  harness: GovernedClickHouseHarness;
  table: string;
  tenantColumn: string;
}): Promise<SeedControl> {
  const rows = await selectRows<{ tenant: string; row_count: string }>(
    harness.admin,
    `SELECT ${tenantColumn} AS tenant, count() AS row_count ` +
      `FROM ${harness.names.database}.${table} GROUP BY tenant`,
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
  harness: GovernedClickHouseHarness;
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
  harness: GovernedClickHouseHarness;
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
  harness: GovernedClickHouseHarness;
  keyHash?: string;
  table: string;
  tenantColumn: string;
  context: string;
}): Promise<void> {
  const control = await recordSeedControl({ harness, table, tenantColumn });
  const client = await harness.restrictedClient(
    keyHash === undefined ? {} : { keyHash },
  );
  const rows = await selectRows<Record<string, unknown>>(
    client,
    `SELECT * FROM ${harness.names.database}.${table}`,
  );
  expect(
    rows,
    `${context}: expected zero rows while ${control.tenantA + control.tenantB} rows exist`,
  ).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// PostgreSQL half
// ---------------------------------------------------------------------------

/** The PostgreSQL role the named collection connects as. */
const PG_READER_ROLE = "ch_reader";
const PG_READER_PASSWORD = "governed-pg-reader-test-password";
const PG_ADMIN_USER = "test";
const PG_ADMIN_PASSWORD = "test";
const PG_DATABASE = "lwtest";
/** The base table. Never granted to the reader; only the view over it is. */
const PG_BASE_TABLE = "annotations";
/** The approved view. Excludes `secret_note`, which no governed query can reach. */
const PG_APPROVED_VIEW = "approved_annotations";
const PG_NAMED_COLLECTION = "pg_analytics";
/** The mapped table's name inside the governed ClickHouse database. */
export const PG_MAPPED_TABLE = "annotations";
/** The mapped table's tenant column. Lower-case: it is PostgreSQL's. */
export const PG_MAPPED_TENANT_COLUMN = "tenant_id";

export interface PostgresExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GovernedPostgresHarness {
  container: StartedPostgreSqlContainer;
  baseTable: string;
  approvedView: string;
  readerRole: string;
  /** Runs SQL as the PostgreSQL superuser, over the local socket. */
  asAdmin(sql: string): Promise<PostgresExecResult>;
  /** Runs SQL as the restricted `ch_reader` role, over TCP with its password. */
  asReader(sql: string): Promise<PostgresExecResult>;
  /** Everything the server has logged so far. */
  readLog(): Promise<string>;
  stop(): Promise<void>;
}

/**
 * Starts PostgreSQL, seeds two tenants' annotations, and provisions the
 * dedicated reader role from the shipped statements.
 *
 * `log_statement='all'` is turned on *before* ClickHouse ever connects. That
 * ordering is the whole trick: ClickHouse pools its PostgreSQL connections, and
 * a connection opened before the setting was changed keeps the old value, so
 * enabling it later measures nothing until the pool is cycled.
 */
export async function startGovernedPostgres(): Promise<GovernedPostgresHarness> {
  const container = await new PostgreSqlContainer(TEST_POSTGRES_IMAGE)
    .withUsername(PG_ADMIN_USER)
    .withPassword(PG_ADMIN_PASSWORD)
    .withDatabase(PG_DATABASE)
    .withLabels({
      "langwatch.test": "true",
      "langwatch.test.type": "integration",
    })
    .withReuse()
    .withStartupTimeout(120_000)
    .start();

  const psql = async ({
    sql,
    user,
    password,
  }: {
    sql: string;
    user: string;
    password?: string;
  }): Promise<PostgresExecResult> => {
    const command = [
      "psql",
      ...(password ? ["-h", "127.0.0.1"] : []),
      "-U",
      user,
      "-d",
      PG_DATABASE,
      "-v",
      "ON_ERROR_STOP=1",
      // Verbose verbosity is what puts the SQLSTATE in the message, which is
      // the only thing worth asserting on a rejection.
      "-v",
      "VERBOSITY=verbose",
      "-tAc",
      sql,
    ];
    const result = await container.exec(
      command,
      password ? { env: { PGPASSWORD: password } } : {},
    );
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  };

  const asAdmin = (sql: string) => psql({ sql, user: PG_ADMIN_USER });
  const asReader = (sql: string) =>
    psql({ sql, user: PG_READER_ROLE, password: PG_READER_PASSWORD });

  const applyAsAdmin = async (statements: string[]): Promise<void> => {
    for (const sql of statements) {
      const result = await asAdmin(sql);
      if (result.exitCode !== 0) {
        throw new Error(
          `governed-sql PostgreSQL setup failed (${result.exitCode}) for:\n${sql}\n${result.stderr}`,
        );
      }
    }
  };

  await applyAsAdmin([
    `ALTER DATABASE ${PG_DATABASE} SET log_statement='all'`,
    `DROP VIEW IF EXISTS ${PG_APPROVED_VIEW}`,
    `DROP TABLE IF EXISTS ${PG_BASE_TABLE}`,
    `CREATE TABLE ${PG_BASE_TABLE} (id text primary key, tenant_id text not null, ` +
      `trace_id text not null, thumbs text not null, secret_note text)`,
    `CREATE VIEW ${PG_APPROVED_VIEW} AS SELECT id, tenant_id, trace_id, thumbs FROM ${PG_BASE_TABLE}`,
    `INSERT INTO ${PG_BASE_TABLE} VALUES ` +
      [TENANT_A, TENANT_B]
        .flatMap((tenant) =>
          [1, 2].map(
            (index) =>
              `('${tenant.tenantId}-note-${index}', '${tenant.tenantId}', ` +
              `'${tenant.tenantId}-trace-${index}', 'up', 'secret-of-${tenant.tenantId}')`,
          ),
        )
        .join(", "),
  ]);
  await applyAsAdmin(
    postgresReaderRoleStatements({
      reader: {
        role: PG_READER_ROLE,
        password: PG_READER_PASSWORD,
        schema: "public",
        approvedViews: [PG_APPROVED_VIEW],
        connectionLimit: 5,
        statementTimeout: "10s",
      },
    }),
  );

  return {
    container,
    baseTable: PG_BASE_TABLE,
    approvedView: PG_APPROVED_VIEW,
    readerRole: PG_READER_ROLE,
    asAdmin,
    asReader,
    readLog: () => readContainerLog(container.logs()),
    async stop() {
      // Reusable container, deliberately left running.
    },
  };
}

/**
 * Maps the approved PostgreSQL view into the governed ClickHouse database and
 * policies it exactly like a native table.
 */
export async function mapPostgresIntoClickHouse({
  harness,
  postgres,
}: {
  harness: GovernedClickHouseHarness;
  postgres: GovernedPostgresHarness;
}): Promise<GovernedTable> {
  const governedTable: GovernedTable = {
    table: PG_MAPPED_TABLE,
    tenantColumn: PG_MAPPED_TENANT_COLUMN,
  };
  await harness.applyAsAdmin([
    ...postgresNamedCollectionStatements({
      connection: {
        collection: PG_NAMED_COLLECTION,
        // The docker host as seen from inside the ClickHouse container; see the
        // module comment for why this is not a shared docker network.
        host: "host.docker.internal",
        port: postgres.container.getPort(),
        database: PG_DATABASE,
        user: PG_READER_ROLE,
        password: PG_READER_PASSWORD,
      },
    }),
    `DROP TABLE IF EXISTS ${harness.names.database}.${PG_MAPPED_TABLE}`,
    postgresEngineTableStatement({
      names: harness.names,
      table: PG_MAPPED_TABLE,
      columns: [
        { name: "id", type: "String" },
        { name: "tenant_id", type: "String" },
        { name: "trace_id", type: "String" },
        { name: "thumbs", type: "String" },
      ],
      collection: PG_NAMED_COLLECTION,
      postgresRelation: PG_APPROVED_VIEW,
    }),
    governedGrantStatement({ names: harness.names, table: PG_MAPPED_TABLE }),
    governedRowPolicyStatement({ names: harness.names, governedTable }),
  ]);
  return governedTable;
}

/**
 * Drains a container log stream into a string.
 *
 * `logs()` follows the container, so it never ends on its own: collection stops
 * once the stream has been quiet for a moment, bounded by a hard cap.
 */
async function readContainerLog(
  streamPromise: Promise<Readable>,
  { quietMs = 400, maxMs = 8_000 } = {},
): Promise<string> {
  const stream = await streamPromise;
  return await new Promise<string>((resolve) => {
    let buffer = "";
    let settled = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let cap: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(quiet);
      clearTimeout(cap);
      stream.destroy();
      resolve(buffer);
    };
    cap = setTimeout(finish, maxMs);
    quiet = setTimeout(finish, quietMs);
    stream.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      clearTimeout(quiet);
      quiet = setTimeout(finish, quietMs);
    });
    stream.on("end", finish);
    stream.on("error", finish);
  });
}

/**
 * The statements PostgreSQL executed since `previousLog` was captured.
 *
 * Diffing rather than parsing timestamps: the suite runs serially, so
 * everything new in the log belongs to the statement under measurement.
 */
export function statementsLoggedSince(
  previousLog: string,
  currentLog: string,
): string[] {
  const delta = currentLog.startsWith(previousLog)
    ? currentLog.slice(previousLog.length)
    : currentLog;
  return [...delta.matchAll(/LOG:\s+statement:\s+(.*)/g)].map((match) =>
    match[1]!.trim(),
  );
}

/** Pulls the SQLSTATE out of a `VERBOSITY=verbose` psql rejection. */
export function postgresSqlState(result: PostgresExecResult): string | null {
  const match = /ERROR:\s+([0-9A-Z]{5}):/.exec(result.stderr);
  return match ? match[1]! : null;
}

/**
 * Asserts a PostgreSQL statement was rejected with one specific SQLSTATE.
 *
 * Same discipline as {@link expectClickHouseError}: a rejection for the wrong
 * reason — a missing relation, a syntax error — must fail rather than count as
 * the containment being proved.
 */
export function expectPostgresError(
  result: PostgresExecResult,
  expectedSqlState: (typeof POSTGRES_SQLSTATE)[keyof typeof POSTGRES_SQLSTATE],
  context: string,
): void {
  expect(
    result.exitCode,
    `${context}: expected a rejection, psql exited 0 with "${result.stdout.trim()}"`,
  ).not.toBe(0);
  const sqlState = postgresSqlState(result);
  expect(
    sqlState,
    `${context}: no SQLSTATE in "${result.stderr.trim()}"`,
  ).not.toBeNull();
  expect(
    sqlState,
    `${context}: wrong rejection — "${result.stderr.trim()}"`,
  ).toBe(expectedSqlState);
}
