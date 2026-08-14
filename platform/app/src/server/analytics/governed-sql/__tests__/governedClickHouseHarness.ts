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
 *    containers (the sweep above) when changing which objects are provisioned,
 *    not just how.
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
import { migrateUp } from "../../../clickhouse/goose";
import { governedTenantCapability } from "../capability";
import { GOVERNED_VIEW_CATALOG } from "../catalog/governedViews";
import {
  type GovernedPostgresMapping,
  type GovernedViewDefinition,
  governedPostgresViews,
} from "../catalog/types";
import {
  DEFAULT_POSTGRES_READER_LIMITS,
  postgresNamedCollectionStatements,
  postgresReaderRoleStatements,
} from "../postgresMapping";
import {
  CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH,
  CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH,
  CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML,
  clickHouseAccessManagementConfigXml,
  type GovernedSqlNames,
  type GovernedTable,
  governedClickHouseSetupStatements,
  governedRowPolicyStatement,
} from "../provisioning";
import {
  governedApprovedPostgresViewNames,
  governedPostgresApprovedViewStatements,
  governedPostgresEngineTableStatements,
  governedPostgresReaderConnectionLimit,
} from "../views";

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
  /** What `statement_timeout` raises when it fires. */
  QUERY_CANCELED: "57014",
} as const;

/**
 * A tenant, its governed SQL secret, and the hash that is all ClickHouse ever
 * sees.
 *
 * The secret stands in for `Project.governedSqlKey`, never for a credential a
 * caller authenticates with: the capability names a tenant, and the two values
 * rotate independently (see `../capability.ts`).
 */
export interface GovernedTenantFixture {
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

function tenantFixture(
  tenantId: string,
  rawSecret: string,
): GovernedTenantFixture {
  return {
    tenantId,
    rawSecret,
    // Derived through the production function rather than re-hashed here: the
    // key map only resolves a tenant when the two agree, and a fixture with its
    // own copy of the algorithm would drift into seeding a digest production
    // never computes — surfacing as every governed read returning zero rows,
    // which is indistinguishable from a tenant that simply has no data. What
    // pins the digest to SHA-256 is a known-answer assertion, in
    // `tenantIsolation.integration.test.ts`.
    keyHash: governedTenantCapability({ secret: rawSecret }),
  };
}

export const TENANT_A = tenantFixture(
  "tenant-a",
  "raw-governed-sql-key-DO-NOT-LOG-abcdef123456",
);
export const TENANT_B = tenantFixture(
  "tenant-b",
  "raw-governed-sql-key-VICTIM-DO-NOT-LOG-fedcba654321",
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

/**
 * Where the fact tables the proof reads come from.
 *
 * `fixture` is two toy `MergeTree` tables created by this harness — enough to
 * prove row policies, grants and settings behave, and deliberately unlike the
 * real schema so nothing about the real schema can be inferred from it passing.
 *
 * `migrated` runs the *shipped* ClickHouse migrations into the container and
 * seeds the real `trace_summaries` / `stored_spans` / `evaluation_runs` /
 * `simulation_runs` — the tables the governed views are built over. Anything
 * about deduplication, partition pruning or column types is only meaningful
 * against these: a `MergeTree` fixture has no versions to collapse and one
 * partition to prune.
 */
export type GovernedFactTableMode = "fixture" | "migrated";

export interface GovernedClickHouseHarness {
  names: GovernedSqlNames;
  /** Administrative client. Reads `system.*`, seeds fixtures, runs audits. */
  admin: ClickHouseClient;
  tenantA: GovernedTenantFixture;
  tenantB: GovernedTenantFixture;
  governedTables: GovernedTable[];
  /**
   * Database holding the fact tables the governed views read.
   *
   * The governed database under `fixture`; a separate migrated database under
   * `migrated`, because the shipped migrations own every table in the database
   * they run against and would collide with the governed objects.
   */
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

function writeConfigFile(
  directory: string,
  name: string,
  contents: string,
): string {
  const path = join(directory, name);
  writeFileSync(path, contents);
  return path;
}

/**
 * Starts ClickHouse with the server-level prerequisites installed, then applies
 * the shipped provisioning and seeds two tenants' rows.
 *
 * Under `facts: "migrated"` the shipped ClickHouse migrations run into a second
 * database first, and the access model is provisioned with no governed tables
 * of its own — the caller applies `governedViewSetupStatements` over the
 * migrated tables instead. The whole-table grant the fixture path issues would
 * otherwise sit *underneath* the column-scoped one and quietly widen it back
 * out, since ClickHouse grants are additive.
 */
export async function startGovernedClickHouse({
  suite,
  facts = "fixture",
}: {
  suite: string;
  facts?: GovernedFactTableMode;
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

  const factDatabase =
    facts === "migrated" ? `${names.database}_facts` : names.database;
  const governedTables = facts === "migrated" ? [] : GOVERNED_FACT_TABLES;

  if (facts === "migrated") {
    await runShippedMigrations({ container, database: factDatabase });
  } else {
    await applyAsAdmin(
      Object.entries(FACT_TABLE_DDL).map(
        ([table, ddl]) => `CREATE TABLE ${names.database}.${table} ${ddl}`,
      ),
    );
  }

  await applyAsAdmin(
    governedClickHouseSetupStatements({
      names,
      password: RESTRICTED_PASSWORD,
      governedTables,
    }),
  );

  await seedKeyMap({ admin, names });
  if (facts === "migrated") {
    await seedRealFactRows({ admin, database: factDatabase });
  } else {
    await seedTenantRows({ admin, names });
  }

  const harness: GovernedClickHouseHarness = {
    names,
    admin,
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    governedTables,
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

/** One live key-map entry per tenant. Both fact-table modes need this. */
async function seedKeyMap({
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
}

/** Two tenants, each with rows in every fixture fact table. */
async function seedTenantRows({
  admin,
  names,
}: {
  admin: ClickHouseClient;
  names: GovernedSqlNames;
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
// The real fact tables
// ---------------------------------------------------------------------------

/** Fact tables the governed views read, by the name the migrations give them. */
export const REAL_FACT_TABLES = [
  "trace_summaries",
  "stored_spans",
  "evaluation_runs",
  "simulation_runs",
] as const;

/**
 * Runs the shipped ClickHouse migrations into their own database.
 *
 * Its own, not the governed one: the migrations own every table in the database
 * they run against, and the governed database holds the key map and the views.
 *
 * `CLICKHOUSE_CLUSTER` is unset for the duration. It is a *deployment* fact
 * that switches every engine to its `Replicated` form, and a developer whose
 * `.env` carries it would otherwise get migrations that need a Keeper the
 * container has not got — a failure that reads like a broken migration.
 */
async function runShippedMigrations({
  container,
  database,
}: {
  container: StartedClickHouseContainer;
  database: string;
}): Promise<void> {
  const previousCluster = process.env.CLICKHOUSE_CLUSTER;
  delete process.env.CLICKHOUSE_CLUSTER;
  try {
    await migrateUp({
      connectionUrl: container.getConnectionUrl(),
      database,
    });
  } finally {
    if (previousCluster !== undefined) {
      process.env.CLICKHOUSE_CLUSTER = previousCluster;
    }
  }
}

/**
 * The seeded history: eight weekly partitions, the last of which is the window
 * a "recent" query asks for.
 *
 * Fixed dates rather than offsets from `now`, so a reused container seeded last
 * week and a fresh one seeded today hold the same partitions and the pruning
 * measurement compares like with like.
 */
export const SEED_WEEK_COUNT = 8;
const SEED_ANCHOR = Date.UTC(2026, 0, 5); // a Monday, so weeks line up
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const SEED_TRACES_PER_WEEK = 250;
export const SEED_EVALUATIONS_PER_WEEK = 25;

/** Start of seeded week `index`, as ClickHouse's `DateTime64` input format. */
function seedWeekStart(index: number): string {
  return new Date(SEED_ANCHOR + index * WEEK_MS)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");
}

/** The single week a "recent" query narrows to — the last one seeded. */
export const SEED_RECENT_WEEK = {
  from: seedWeekStart(SEED_WEEK_COUNT - 1),
  to: seedWeekStart(SEED_WEEK_COUNT),
} as const;

/**
 * Content the seed writes, so a leak assertion names the exact string that
 * would appear rather than checking a field is "not empty".
 */
export const SEEDED_CONTENT = {
  traceInput: "CAPTURED-TRACE-INPUT-do-not-leak",
  traceOutput: "CAPTURED-TRACE-OUTPUT-do-not-leak",
  spanInput: "CAPTURED-SPAN-INPUT-do-not-leak",
  spanOutput: "CAPTURED-SPAN-OUTPUT-do-not-leak",
  /** Written under `gen_ai.prompt`, an exact key of the data-privacy catalog. */
  spanPromptAttribute: "CAPTURED-SPAN-PROMPT-do-not-leak",
  /** Written under `gen_ai.prompt.0.content`, the exploded form of the same key. */
  spanExplodedPromptAttribute: "CAPTURED-SPAN-PROMPT-PART-do-not-leak",
  evaluationInputs: "CAPTURED-EVALUATION-INPUTS-do-not-leak",
  simulationMessage: "CAPTURED-SIMULATION-MESSAGE-do-not-leak",
  simulationReasoning: "CAPTURED-SIMULATION-REASONING-do-not-leak",
} as const;

/** A span attribute that is a dimension rather than content, so it survives. */
export const SEEDED_DIMENSION_ATTRIBUTE = {
  key: "gen_ai.request.model",
  value: "gpt-5-mini",
} as const;

/**
 * The trace seeded twice, to prove the views collapse versions.
 *
 * Both versions carry the same partition-key time and differ only in
 * `UpdatedAt` and in the value a reader can see, so "the view returned one row"
 * and "it returned the newer one" are separate, checkable claims.
 */
export const DEDUP_FIXTURE = {
  traceIdSuffix: "dedup-trace",
  staleSpanCount: 1,
  latestSpanCount: 99,
  staleUpdatedAt: "2026-02-23 00:00:00.000",
  latestUpdatedAt: "2026-02-23 00:00:01.000",
} as const;

/** The trace id the dedup fixture uses for a tenant. */
export function dedupTraceId(tenantId: string): string {
  return `${tenantId}-${DEDUP_FIXTURE.traceIdSuffix}`;
}

/**
 * The trace whose newer version sits in a *different* weekly partition.
 *
 * The incident-backed case, and the one a dedup shape can get wrong without
 * ever returning a duplicate: the partition key is a business time that a later
 * fold can move, so a view that collapses versions per partition — or one whose
 * `max()` scope carries a time range — reports the older version as current and
 * looks entirely healthy doing it.
 */
export const MOVED_PARTITION_FIXTURE = {
  traceIdSuffix: "moved-trace",
  staleWeek: 0,
  latestWeek: SEED_WEEK_COUNT - 1,
  staleSpanCount: 7,
  latestSpanCount: 88,
  staleUpdatedAt: "2026-03-01 00:00:00.000",
  latestUpdatedAt: "2026-03-01 00:00:01.000",
} as const;

/** The trace id the moved-partition fixture uses for a tenant. */
export function movedPartitionTraceId(tenantId: string): string {
  return `${tenantId}-${MOVED_PARTITION_FIXTURE.traceIdSuffix}`;
}

interface TraceSummarySeed {
  TenantId: string;
  TraceId: string;
  OccurredAt: string;
  UpdatedAt: string;
  SpanCount: number;
  [column: string]: unknown;
}

function traceSummaryRow({
  tenantId,
  traceId,
  occurredAt,
  updatedAt,
  spanCount,
}: {
  tenantId: string;
  traceId: string;
  occurredAt: string;
  updatedAt: string;
  spanCount: number;
}): TraceSummarySeed {
  return {
    ProjectionId: `${tenantId}/${traceId}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "1",
    Attributes: {
      "gen_ai.request.model": SEEDED_DIMENSION_ATTRIBUTE.value,
      "gen_ai.prompt": SEEDED_CONTENT.spanPromptAttribute,
    },
    OccurredAt: occurredAt,
    UpdatedAt: updatedAt,
    ComputedIOSchemaVersion: "1",
    ComputedInput: `${SEEDED_CONTENT.traceInput}/${traceId}`,
    ComputedOutput: `${SEEDED_CONTENT.traceOutput}/${traceId}`,
    TotalDurationMs: 1200,
    SpanCount: spanCount,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [SEEDED_DIMENSION_ATTRIBUTE.value],
    TotalCost: 0.0042,
    TokensEstimated: false,
    TraceName: `trace ${traceId}`,
  };
}

/**
 * Seeds both tenants into the real fact tables, across eight weekly partitions.
 *
 * Merges are stopped first. Without that, the two versions of the dedup fixture
 * can be collapsed by a background merge before the test looks, and a
 * deduplicating view would then be indistinguishable from one that does
 * nothing — the test would pass with the dedup removed.
 */
async function seedRealFactRows({
  admin,
  database,
}: {
  admin: ClickHouseClient;
  database: string;
}): Promise<void> {
  for (const table of REAL_FACT_TABLES) {
    await admin.command({ query: `SYSTEM STOP MERGES ${database}.${table}` });
    await admin.command({ query: `TRUNCATE TABLE ${database}.${table}` });
  }

  const tenants = [TENANT_A, TENANT_B];
  const weeks = [...Array(SEED_WEEK_COUNT).keys()];

  const traceRows = tenants.flatMap((tenant) =>
    weeks.flatMap((week) =>
      [...Array(SEED_TRACES_PER_WEEK).keys()].map((index) =>
        traceSummaryRow({
          tenantId: tenant.tenantId,
          traceId: `${tenant.tenantId}-trace-${week}-${index}`,
          occurredAt: seedWeekStart(week),
          updatedAt: seedWeekStart(week),
          spanCount: 3,
        }),
      ),
    ),
  );
  await admin.insert({
    table: `${database}.trace_summaries`,
    format: "JSONEachRow",
    values: traceRows,
  });

  // A separate insert, so the two versions land in separate parts and the
  // engine has something to collapse.
  for (const updatedAt of [
    DEDUP_FIXTURE.staleUpdatedAt,
    DEDUP_FIXTURE.latestUpdatedAt,
  ]) {
    await admin.insert({
      table: `${database}.trace_summaries`,
      format: "JSONEachRow",
      values: tenants.map((tenant) =>
        traceSummaryRow({
          tenantId: tenant.tenantId,
          traceId: dedupTraceId(tenant.tenantId),
          occurredAt: seedWeekStart(SEED_WEEK_COUNT - 1),
          updatedAt,
          spanCount:
            updatedAt === DEDUP_FIXTURE.latestUpdatedAt
              ? DEDUP_FIXTURE.latestSpanCount
              : DEDUP_FIXTURE.staleSpanCount,
        }),
      ),
    });
  }

  // The same shape one partition apart, so a per-partition collapse returns the
  // stale row rather than a duplicate.
  for (const version of [
    {
      week: MOVED_PARTITION_FIXTURE.staleWeek,
      spanCount: MOVED_PARTITION_FIXTURE.staleSpanCount,
      updatedAt: MOVED_PARTITION_FIXTURE.staleUpdatedAt,
    },
    {
      week: MOVED_PARTITION_FIXTURE.latestWeek,
      spanCount: MOVED_PARTITION_FIXTURE.latestSpanCount,
      updatedAt: MOVED_PARTITION_FIXTURE.latestUpdatedAt,
    },
  ]) {
    await admin.insert({
      table: `${database}.trace_summaries`,
      format: "JSONEachRow",
      values: tenants.map((tenant) =>
        traceSummaryRow({
          tenantId: tenant.tenantId,
          traceId: movedPartitionTraceId(tenant.tenantId),
          occurredAt: seedWeekStart(version.week),
          updatedAt: version.updatedAt,
          spanCount: version.spanCount,
        }),
      ),
    });
  }

  await admin.insert({
    table: `${database}.stored_spans`,
    format: "JSONEachRow",
    values: tenants.flatMap((tenant) =>
      weeks.flatMap((week) =>
        [...Array(SEED_TRACES_PER_WEEK).keys()].map((index) => ({
          ProjectionId: `${tenant.tenantId}/span-${week}-${index}`,
          TenantId: tenant.tenantId,
          TraceId: `${tenant.tenantId}-trace-${week}-${index}`,
          SpanId: `${tenant.tenantId}-span-${week}-${index}`,
          Sampled: 1,
          StartTime: seedWeekStart(week),
          EndTime: seedWeekStart(week),
          DurationMs: 250,
          SpanName: "llm.call",
          SpanKind: 3,
          ServiceName: "api",
          ScopeName: "langwatch",
          ResourceAttributes: { "service.name": "api" },
          SpanAttributes: {
            [SEEDED_DIMENSION_ATTRIBUTE.key]: SEEDED_DIMENSION_ATTRIBUTE.value,
            "langwatch.input": SEEDED_CONTENT.spanInput,
            "langwatch.output": SEEDED_CONTENT.spanOutput,
            "gen_ai.prompt": SEEDED_CONTENT.spanPromptAttribute,
            "gen_ai.prompt.0.content":
              SEEDED_CONTENT.spanExplodedPromptAttribute,
          },
          Cost: 0.0021,
        })),
      ),
    ),
  });

  await admin.insert({
    table: `${database}.evaluation_runs`,
    format: "JSONEachRow",
    values: tenants.flatMap((tenant) =>
      weeks.flatMap((week) =>
        [...Array(SEED_EVALUATIONS_PER_WEEK).keys()].map((index) => ({
          ProjectionId: `${tenant.tenantId}/eval-${week}-${index}`,
          TenantId: tenant.tenantId,
          EvaluationId: `${tenant.tenantId}-eval-${week}-${index}`,
          Version: "1",
          EvaluatorId: "quality",
          EvaluatorType: "llm_judge",
          EvaluatorName: "Quality",
          TraceId: `${tenant.tenantId}-trace-${week}-${index}`,
          Status: "processed",
          Score: 0.8,
          Passed: 1,
          Details: "scored on rubric",
          Inputs: `${SEEDED_CONTENT.evaluationInputs}/${tenant.tenantId}`,
          ScheduledAt: seedWeekStart(week),
          UpdatedAt: seedWeekStart(week),
          LastProcessedEventId: "seed",
        })),
      ),
    ),
  });

  await admin.insert({
    table: `${database}.simulation_runs`,
    format: "JSONEachRow",
    values: tenants.flatMap((tenant) =>
      weeks.map((week) => ({
        ProjectionId: `${tenant.tenantId}/sim-${week}`,
        TenantId: tenant.tenantId,
        ScenarioRunId: `${tenant.tenantId}-sim-${week}`,
        ScenarioId: "checkout",
        BatchRunId: `${tenant.tenantId}-batch-${week}`,
        ScenarioSetId: "default",
        Version: "1",
        Status: "SUCCESS",
        Name: "checkout flow",
        "Messages.Id": ["m1"],
        "Messages.Role": ["assistant"],
        "Messages.Content": [
          `${SEEDED_CONTENT.simulationMessage}/${tenant.tenantId}`,
        ],
        "Messages.TraceId": [`${tenant.tenantId}-trace-${week}-0`],
        "Messages.Rest": ["{}"],
        TraceIds: [`${tenant.tenantId}-trace-${week}-0`],
        Verdict: "success",
        Reasoning: `${SEEDED_CONTENT.simulationReasoning}/${tenant.tenantId}`,
        MetCriteria: ["completes checkout"],
        UnmetCriteria: [],
        StartedAt: seedWeekStart(week),
        CreatedAt: seedWeekStart(week),
        UpdatedAt: seedWeekStart(week),
      })),
    ),
  });
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** What one query cost, read back from the server's own accounting. */
export interface GovernedQueryMeasurement {
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
  harness: GovernedClickHouseHarness;
  client: ClickHouseClient;
  query: string;
}): Promise<GovernedQueryMeasurement> {
  const queryId = `governed-measure-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
export async function selectScalar<T>(
  client: ClickHouseClient,
  query: string,
): Promise<T> {
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
  expect(
    thrown,
    `${context}: expected a rejection, the statement succeeded`,
  ).toBeDefined();
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
  database,
}: {
  harness: GovernedClickHouseHarness;
  table: string;
  tenantColumn: string;
  /** Defaults to the governed database; the migrated facts live elsewhere. */
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
  harness: GovernedClickHouseHarness;
  context: string;
}): void {
  expect(
    rows.length,
    `${context}: read returned nothing to check`,
  ).toBeGreaterThan(0);
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
/** How long a terminated reader backend gets to leave `pg_stat_activity`. */
const PG_BACKEND_EXIT_TIMEOUT_MS = 15_000;
const PG_BACKEND_EXIT_POLL_MS = 50;
const PG_READER_PASSWORD = "governed-pg-reader-test-password";
const PG_ADMIN_USER = "test";
const PG_ADMIN_PASSWORD = "test";
const PG_DATABASE = "lwtest";
const PG_SCHEMA = "public";

/**
 * The named collection this suite's engine tables read through.
 *
 * Per-suite for the same reason `governedNamesForSuite` exists: named
 * collections are server-global, and CI runs integration files two at a time
 * against one ClickHouse server. Under a shared name, each suite's
 * DROP + CREATE repoints the collection at its own PostgreSQL container —
 * the neighbour's engine tables silently read the wrong database, or lose
 * the collection entirely mid-run. (Shipped provisioning keeps one fixed
 * name; a deployment has one PostgreSQL, not one per suite.)
 */
export function governedTestNamedCollection(names: GovernedSqlNames): string {
  return `pg_${names.database}`;
}

/**
 * The dataset the PostgreSQL isolation proof is written against.
 *
 * Annotations rather than a dimension, because it is the one mapped dataset
 * that joins against a multi-million-row fact table and therefore the one the
 * issue names as most likely to need the projection fallback. Read from the
 * shipped catalog rather than restated, so a rename cannot leave the proof
 * pointing at something that no longer exists.
 */
export const PG_MAPPED_VIEW = "annotations";
/** The PostgreSQL-engine table behind it, inside the governed database. */
export const PG_MAPPED_TABLE = mappedCatalogEntry(PG_MAPPED_VIEW).sourceTable;
/** The tenant column, which every approved view exposes under the same name. */
export const PG_MAPPED_TENANT_COLUMN = "TenantId";
/**
 * A column of the base relation the approved view leaves out.
 *
 * `Annotation.comment` is a free-text carrier the catalog deliberately does not
 * expose. Taken from the real model rather than a synthetic `secret_note`, so
 * the unreachability proof is about the shipped exclusion policy.
 */
export const PG_EXCLUDED_COLUMN = "comment";

/** One PostgreSQL-resident catalog entry, by the name a caller writes. */
function mappedCatalogEntry(
  name: string,
): GovernedViewDefinition & { postgres: GovernedPostgresMapping } {
  const entry = governedPostgresViews(GOVERNED_VIEW_CATALOG).find(
    (view) => view.name === name,
  );
  if (!entry) {
    throw new Error(
      `governed-sql harness: "${name}" is not a PostgreSQL-resident dataset in the shipped catalog`,
    );
  }
  return entry;
}

export interface PostgresExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GovernedPostgresHarness {
  container: StartedPostgreSqlContainer;
  /** The base relation behind {@link PG_MAPPED_VIEW}. Never granted to the reader. */
  baseTable: string;
  /** The approved view over it. The reader's only relation for that dataset. */
  approvedView: string;
  readerRole: string;
  /**
   * The reader role's password, the live value the role was provisioned with —
   * exposed so a leak assertion searches for the string that would actually
   * leak rather than a hand-copy that can drift and go vacuous.
   */
  readerPassword: string;
  /** Runs SQL as the PostgreSQL superuser, over the local socket. */
  asAdmin(sql: string): Promise<PostgresExecResult>;
  /** Runs SQL as the restricted `ch_reader` role, over TCP with its password. */
  asReader(sql: string): Promise<PostgresExecResult>;
  /** Everything the server has logged so far. */
  readLog(): Promise<string>;
  /** Clears the server's table statistics, so the next {@link rowsRead} is a delta. */
  resetStatistics(): Promise<void>;
  /**
   * Makes every read done so far visible to {@link rowsRead}, by ending the
   * backends that did it.
   *
   * PostgreSQL flushes a backend's pending statistics at transaction end, rate
   * limited to once a second, and otherwise only when the backend has been idle
   * for ten. ClickHouse *pools* its connections, so the backend that did the
   * read is idle rather than gone and its numbers are not there yet — measured,
   * a two-second wait reports the previous measurement's rows, which is worse
   * than reporting none, and even twelve seconds raced.
   *
   * Terminating the backend runs its shutdown hook, which flushes, and this
   * then waits for the backend to actually leave `pg_stat_activity` rather than
   * for a duration. That turns the measurement from a wait long enough to
   * probably work into one that is true when it returns, and it throws rather
   * than returning a stale number if the backends outlast the timeout.
   * ClickHouse reconnects on the next read.
   */
  flushStatistics(): Promise<void>;
  /**
   * Rows PostgreSQL actually read off a base relation since the last reset.
   *
   * The load number the projection-fallback decision turns on, taken from the
   * server's own accounting rather than inferred from the statement text.
   * Sequential and index reads summed, because which one the planner picks is
   * its business and both are rows off the primary.
   */
  rowsRead(baseRelation: string): Promise<number>;
  stop(): Promise<void>;
}

/**
 * The application tables the mapped catalog reads, in the shape Prisma creates
 * them.
 *
 * Hand-written rather than migrated because the suite needs the *relations the
 * catalog names*, not the application's whole schema — every mapped base
 * relation, with every column the catalog reads plus at least one it
 * deliberately excludes. Quoted and mixed-case exactly as Prisma emits them, so
 * that a mapping which forgot to quote fails here rather than in production.
 */
const PG_BASE_TABLE_DDL: Record<string, string> = {
  Annotation:
    '("id" text primary key, "projectId" text not null, "traceId" text not null, ' +
    '"isThumbsUp" boolean, "comment" text, "email" text, "createdAt" timestamptz not null, ' +
    '"updatedAt" timestamptz not null)',
  Project:
    '("id" text primary key, "name" text not null, "slug" text not null, ' +
    '"apiKey" text not null, "createdAt" timestamptz not null)',
  // `type` is a PostgreSQL *enum* here, not text, because that is what Prisma
  // creates for `ExperimentType` — and whether ClickHouse's PostgreSQL engine
  // can read an enum column at all is exactly the kind of thing a `text` stand-in
  // would hide until production.
  Experiment:
    '("id" text primary key, "projectId" text not null, "name" text, "slug" text not null, ' +
    '"type" "ExperimentType" not null, "workbenchState" jsonb, "createdAt" timestamptz not null, ' +
    '"archivedAt" timestamptz)',
  BatchEvaluation:
    '("id" text primary key, "projectId" text not null, "experimentId" text not null, ' +
    '"evaluation" text not null, "status" text not null, "score" double precision not null, ' +
    '"label" text, "passed" boolean not null, "cost" double precision not null, ' +
    '"datasetId" text not null, "datasetSlug" text not null, "details" text not null, ' +
    '"data" jsonb not null, "createdAt" timestamptz not null)',
  LlmPromptConfig:
    '("id" text primary key, "projectId" text not null, "name" text not null, ' +
    '"handle" text, "createdAt" timestamptz not null, "deletedAt" timestamptz)',
  LlmPromptConfigVersion:
    '("id" text primary key, "projectId" text not null, "configId" text not null, ' +
    '"version" integer not null, "commitMessage" text, "configData" jsonb not null, ' +
    '"createdAt" timestamptz not null)',
};

/**
 * Governed databases that map this one PostgreSQL role at the same time.
 *
 * Container reuse is what makes this more than one: every suite that maps the
 * PostgreSQL half gets its own governed database inside the *same* reused
 * ClickHouse server, and each of those databases holds its own connection pool
 * per mapped table against the same role. Sized for one catalog, the role's cap
 * is exhausted by idle pooled connections from the suites that ran before, and
 * the failure is a refused login rather than a queue.
 *
 * Production maps one catalog from one deployment, which is the function's
 * default.
 */
const GOVERNED_TEST_CONCURRENT_CATALOGS = 6;

/** The role's cap in this harness, so a test can assert the value that was set. */
export const GOVERNED_TEST_POSTGRES_CONNECTION_LIMIT =
  governedPostgresReaderConnectionLimit({
    concurrentCatalogs: GOVERNED_TEST_CONCURRENT_CATALOGS,
  });

/** Filler tenants in the annotation load fixture. See below for why. */
const PG_LOAD_FIXTURE_TENANTS = 40;
/** Annotations each filler tenant holds. */
const PG_LOAD_FIXTURE_ROWS_PER_TENANT = 250;

/**
 * A realistically-shaped annotation table, so the load measurement measures
 * something.
 *
 * Not padding. With only the two fixture tenants the table is four rows split
 * evenly, and at 50% selectivity a sequential scan is genuinely the cheaper
 * plan — so PostgreSQL reads every row whether or not the tenant predicate
 * reached it, and "the predicate bounds what PostgreSQL reads" is unmeasurable
 * rather than untrue. A real deployment has many tenants and one of them asking,
 * which is the shape that makes the index worth using; these filler tenants
 * restore it.
 *
 * The index is the one Prisma already declares (`@@index([projectId])`), and
 * `ANALYZE` is what gives the planner the statistics to choose it.
 */
const POSTGRES_LOAD_FIXTURE_STATEMENTS: string[] = [
  `INSERT INTO ${PG_SCHEMA}."Annotation" ` +
    `SELECT 'filler-note-' || g, 'filler-tenant-' || (g % ${PG_LOAD_FIXTURE_TENANTS}), ` +
    `'filler-trace-' || g, true, 'excluded-comment-of-filler', 'excluded-email-of-filler', ` +
    `now(), now() ` +
    `FROM generate_series(1, ${PG_LOAD_FIXTURE_TENANTS * PG_LOAD_FIXTURE_ROWS_PER_TENANT}) g`,
  `CREATE INDEX IF NOT EXISTS "Annotation_projectId_idx" ON ${PG_SCHEMA}."Annotation" ("projectId")`,
  `ANALYZE ${PG_SCHEMA}."Annotation"`,
];

/**
 * One tenant's rows in every mapped base relation.
 *
 * Parameterized rather than fixed to the two harness fixtures because the
 * endpoint suites authenticate as *real project ids* and need PostgreSQL rows
 * under those, exactly as they already seed their own ClickHouse rows. Every
 * relation for every tenant, so that an isolation assertion always has
 * something it could have leaked.
 *
 * Excluded columns carry a recognisable `excluded-` marker, which is what lets
 * a test assert the *data* never reached the governed schema rather than only
 * that the column name was refused.
 *
 * `traceIds` ties annotations to whatever traces the caller seeded on the
 * ClickHouse side, so an annotation-to-trace join has matching rows; the
 * default is the shape the isolation suite seeds.
 */
export function postgresTenantSeedStatements({
  tenantId,
  traceIds = [`${tenantId}-trace-1`, `${tenantId}-trace-2`],
  thumbsUp = [true, false],
  scores = [0.5, 0.9],
  promptId = `${tenantId}-prompt`,
  stamp = "2026-01-01T00:00:00Z",
}: {
  tenantId: string;
  /** Traces the seeded annotations point at. One annotation per entry. */
  traceIds?: readonly string[];
  /** The verdict of the annotation at each index, cycled if shorter. */
  thumbsUp?: readonly (boolean | null)[];
  /** The score of the experiment run at each index. */
  scores?: readonly number[];
  /**
   * Identifier of the seeded prompt.
   *
   * Parameterized because a caller joining `traces.LastUsedPromptId` to
   * `prompts.PromptId` needs the two sides to agree, and a prompt id is a
   * primary key in PostgreSQL — so two tenants cannot both be given the same
   * one, and which tenant gets which is the caller's to decide.
   */
  promptId?: string;
  stamp?: string;
}): string[] {
  const at = `'${stamp}'`;
  const rows = (table: string, values: string[]): string =>
    `INSERT INTO ${PG_SCHEMA}."${table}" VALUES ${values.join(", ")}`;
  const verdict = (index: number): string => {
    const value = thumbsUp[index % thumbsUp.length];
    return value === null || value === undefined ? "NULL" : String(value);
  };
  return [
    rows("Project", [
      `('${tenantId}', 'Project ${tenantId}', '${tenantId}-slug', ` +
        `'excluded-apikey-of-${tenantId}', ${at})`,
    ]),
    rows(
      "Annotation",
      traceIds.map(
        (traceId, index) =>
          `('${tenantId}-note-${index + 1}', '${tenantId}', '${traceId}', ${verdict(index)}, ` +
          `'excluded-comment-of-${tenantId}', 'excluded-email-of-${tenantId}', ${at}, ${at})`,
      ),
    ),
    rows("Experiment", [
      `('${tenantId}-experiment', '${tenantId}', 'Experiment ${tenantId}', ` +
        `'${tenantId}-exp-slug', 'BATCH_EVALUATION_V2', '{"excluded":"workbench"}'::jsonb, ${at}, NULL)`,
    ]),
    rows(
      "BatchEvaluation",
      scores.map(
        (score, index) =>
          `('${tenantId}-run-${index + 1}', '${tenantId}', '${tenantId}-experiment', ` +
          `'exact_match', 'finished', ${score}, 'label-${index + 1}', ` +
          `${score >= 0.8}, ${index + 1}.25, 'dataset-${index + 1}', 'dataset-slug-${index + 1}', ` +
          `'excluded-details-of-${tenantId}', '{"excluded":"rows"}'::jsonb, ${at})`,
      ),
    ),
    rows("LlmPromptConfig", [
      `('${promptId}', '${tenantId}', 'Prompt ${tenantId}', ` +
        `'${tenantId}/handle', ${at}, NULL)`,
    ]),
    rows(
      "LlmPromptConfigVersion",
      [1, 2].map(
        (version) =>
          `('${promptId}-v${version}', '${tenantId}', '${promptId}', ` +
          `${version}, 'excluded-commit-of-${tenantId}', '{"excluded":"prompt text"}'::jsonb, ${at})`,
      ),
    ),
  ];
}

/**
 * Starts PostgreSQL, seeds two tenants' annotations, and provisions the
 * dedicated reader role from the shipped statements.
 *
 * `log_statement='all'` is turned on *before* ClickHouse ever connects. That
 * ordering is the whole trick: ClickHouse pools its PostgreSQL connections, and
 * a connection opened before the setting was changed keeps the old value, so
 * enabling it later measures nothing until the pool is cycled.
 *
 * Deliberately NOT `.withReuse()`, unlike the ClickHouse container beside it.
 * Reuse hands every caller the same container, and this setup drops and
 * recreates a fixed set of relations in a fixed schema — so with
 * `VITEST_INTEGRATION_PARALLEL=1` (CI, `maxWorkers: 2`) two suites interleave
 * their drop/create and the second `CREATE TYPE "ExperimentType"` loses to the
 * first with `42710: type already exists`. The ClickHouse half is safe because
 * each suite gets its own governed database; the PostgreSQL half has no such
 * per-suite name, so isolation comes from the container. A private container
 * per suite costs a few seconds and removes the race by construction.
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

  const mapped = mappedCatalogEntry(PG_MAPPED_VIEW);
  const baseRelations = Object.keys(PG_BASE_TABLE_DDL);
  await applyAsAdmin([
    `ALTER DATABASE ${PG_DATABASE} SET log_statement='all'`,
    ...governedApprovedPostgresViewNames().map(
      (view) => `DROP VIEW IF EXISTS ${PG_SCHEMA}."${view}"`,
    ),
    ...baseRelations.map(
      (table) => `DROP TABLE IF EXISTS ${PG_SCHEMA}."${table}"`,
    ),
    `DROP TYPE IF EXISTS ${PG_SCHEMA}."ExperimentType"`,
    `CREATE TYPE ${PG_SCHEMA}."ExperimentType" AS ENUM ` +
      `('DSPY', 'BATCH_EVALUATION', 'BATCH_EVALUATION_V2')`,
    ...baseRelations.map(
      (table) =>
        `CREATE TABLE ${PG_SCHEMA}."${table}" ${PG_BASE_TABLE_DDL[table]!}`,
    ),
    ...[TENANT_A, TENANT_B].flatMap((tenant) =>
      postgresTenantSeedStatements({ tenantId: tenant.tenantId }),
    ),
    ...POSTGRES_LOAD_FIXTURE_STATEMENTS,
    // The shipped generator, not a hand-copy: a catalog column the approved
    // view forgot would be a failure here rather than a silent exposure.
    ...governedPostgresApprovedViewStatements({ schema: PG_SCHEMA }),
  ]);
  await applyAsAdmin(
    postgresReaderRoleStatements({
      reader: {
        role: PG_READER_ROLE,
        password: PG_READER_PASSWORD,
        schema: PG_SCHEMA,
        approvedViews: governedApprovedPostgresViewNames(),
        ...DEFAULT_POSTGRES_READER_LIMITS,
        connectionLimit: GOVERNED_TEST_POSTGRES_CONNECTION_LIMIT,
      },
    }),
  );

  return {
    container,
    baseTable: mapped.postgres.baseRelation,
    approvedView: mapped.postgres.approvedView,
    readerRole: PG_READER_ROLE,
    readerPassword: PG_READER_PASSWORD,
    asAdmin,
    asReader,
    readLog: () => readContainerLog(container.logs()),
    async resetStatistics() {
      await applyAsAdmin(["SELECT pg_stat_reset()"]);
    },
    async flushStatistics() {
      await applyAsAdmin([
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity ` +
          `WHERE usename = '${PG_READER_ROLE}' AND pid <> pg_backend_pid()`,
      ]);
      // `pg_terminate_backend` only signals; it returns before the backend has
      // run the shutdown hook that flushes its statistics. Waiting for the rows
      // to leave `pg_stat_activity` waits for the thing that actually has to
      // have happened — a fixed grace period here would be the hopeful wait
      // this whole mechanism exists to avoid, and it is the shape that flakes
      // first on a loaded CI worker.
      const deadline = Date.now() + PG_BACKEND_EXIT_TIMEOUT_MS;
      for (;;) {
        const remaining = await asAdmin(
          `SELECT count(*) FROM pg_stat_activity ` +
            `WHERE usename = '${PG_READER_ROLE}' AND pid <> pg_backend_pid()`,
        );
        if (remaining.exitCode === 0 && remaining.stdout.trim() === "0") return;
        if (Date.now() >= deadline) {
          throw new Error(
            `governed-sql harness: ${PG_READER_ROLE} backends were still ` +
              `attached ${PG_BACKEND_EXIT_TIMEOUT_MS}ms after termination, so ` +
              `their statistics are not flushed and any measurement taken now ` +
              `would silently report the previous one`,
          );
        }
        await new Promise((resolve) =>
          setTimeout(resolve, PG_BACKEND_EXIT_POLL_MS),
        );
      }
    },
    async rowsRead(baseRelation: string) {
      const result = await asAdmin(
        `SELECT coalesce(seq_tup_read, 0) + coalesce(idx_tup_fetch, 0) ` +
          `FROM pg_stat_user_tables WHERE relname = '${baseRelation}'`,
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `governed-sql harness: reading PostgreSQL statistics failed: ${result.stderr}`,
        );
      }
      return Number(result.stdout.trim() || "0");
    },
    async stop() {
      await container.stop();
    },
  };
}

/**
 * Maps every PostgreSQL-resident catalog entry into the governed ClickHouse
 * database as an engine table, and policies each exactly like a native table.
 *
 * Stops at the engine tables. The governed views over them — the objects a
 * caller actually names, and the ones carrying the tenant pushdown predicate —
 * are `governedViewSetupStatements`' job, so a suite that wants the whole
 * chain calls both, in that order. Keeping them apart is what lets the
 * isolation proof read the *unpredicated* engine table directly and compare.
 */
export async function mapPostgresIntoClickHouse({
  harness,
  postgres,
}: {
  harness: GovernedClickHouseHarness;
  postgres: GovernedPostgresHarness;
}): Promise<GovernedTable[]> {
  const governedTables = governedPostgresViews(GOVERNED_VIEW_CATALOG).map(
    (view): GovernedTable => ({
      table: view.sourceTable,
      tenantColumn: PG_MAPPED_TENANT_COLUMN,
    }),
  );
  const collection = governedTestNamedCollection(harness.names);
  await harness.applyAsAdmin([
    ...postgresNamedCollectionStatements({
      connection: {
        collection,
        // The docker host as seen from inside the ClickHouse container; see the
        // module comment for why this is not a shared docker network.
        host: "host.docker.internal",
        port: postgres.container.getPort(),
        database: PG_DATABASE,
        user: PG_READER_ROLE,
        password: PG_READER_PASSWORD,
      },
    }),
    ...governedTables.map(
      (governedTable) =>
        `DROP TABLE IF EXISTS ${harness.names.database}.${governedTable.table}`,
    ),
    ...governedPostgresEngineTableStatements({
      names: harness.names,
      collection,
    }),
    // No grant here on purpose. `governedViewSetupStatements` issues the
    // column-scoped one for every source it reads, and ClickHouse grants are
    // additive: a whole-table grant issued here would sit underneath it and
    // quietly widen it back out — the same trap the fixture fact tables carry.
    ...governedTables.map((governedTable) =>
      governedRowPolicyStatement({ names: harness.names, governedTable }),
    ),
  ]);
  return governedTables;
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
