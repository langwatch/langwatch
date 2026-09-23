/**
 * Test harness for the LangWatchQL analytics SQL isolation proof.
 *
 * Starts a ClickHouse container (and, on request, a PostgreSQL container) and
 * applies the *shipped* provisioning from `../provisioning` to it. The harness
 * deliberately holds no copy of the LangWatchQL DDL: a proof that runs its own
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
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { lwqlTenantCapability } from "../capability";
import type { DerivedPostgresView } from "../catalog/derivePostgresCatalog";
import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import { LWQL_POSTGRES_CATALOG } from "../catalog/postgresViews";
import { LWQL_PRISMA_MANIFEST } from "../catalog/prismaManifest";
import {
  isPostgresResident,
  type LangWatchQLPostgresMapping,
  type LangWatchQLViewDefinition,
  lwqlPhysicalColumn,
  lwqlPostgresViews,
} from "../catalog/types";
import type { LangWatchQLResourceLimits } from "../limits";
import {
  CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH,
  CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH,
  CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML,
  clickHouseAccessManagementConfigXml,
  type LangWatchQLNames,
  type LangWatchQLTable,
  lwqlClickHouseSetupStatements,
} from "../provisioning/accessModel";
import {
  renderLwqlAccessModelDdl,
  renderLwqlNamedCollectionDdl,
} from "../provisioning/accessModelDdl";
import { buildLwqlAccessModelDefinition } from "../provisioning/accessModelDefinition";
import {
  lwqlApprovedPostgresViewNames,
  lwqlPostgresApprovedViewStatements,
  lwqlPostgresEngineTableStatements,
  lwqlPostgresReaderConnectionLimit,
} from "../provisioning/catalogStatements";
import { CLICKHOUSE_CONFIG_STORE_ERROR_CODE } from "../provisioning/clickhouseStatementRunner";
import {
  DEFAULT_POSTGRES_READER_LIMITS,
  postgresReaderRoleStatements,
} from "../provisioning/postgresMapping";
import { postgresModelSeedStatements } from "./lwqlPostgresModelSeed";

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
  /**
   * An entity owned by the read-only `users_xml` config store cannot be created
   * or altered through SQL — what provisioning tolerates and skips.
   */
  ACCESS_STORAGE_READONLY:
    CLICKHOUSE_CONFIG_STORE_ERROR_CODE.ACCESS_STORAGE_READONLY,
  /** Refused by grants. */
  ACCESS_DENIED: 497,
  /**
   * A `DROP NAMED COLLECTION` of a config-XML-defined collection — the SQL store
   * has no copy to remove, reported even with `IF EXISTS`. Tolerated and skipped.
   */
  NAMED_COLLECTION_DOESNT_EXIST:
    CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_DOESNT_EXIST,
  /** A named collection already defined in a config XML — tolerated and skipped. */
  NAMED_COLLECTION_ALREADY_EXISTS:
    CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_ALREADY_EXISTS,
  /** An immutable, config-XML-owned named collection under ALTER/DROP — tolerated. */
  NAMED_COLLECTION_IS_IMMUTABLE:
    CLICKHOUSE_CONFIG_STORE_ERROR_CODE.NAMED_COLLECTION_IS_IMMUTABLE,
} as const;

/** PostgreSQL SQLSTATEs this proof discriminates between. */
export const POSTGRES_SQLSTATE = {
  READ_ONLY_TRANSACTION: "25006",
  INSUFFICIENT_PRIVILEGE: "42501",
  /** What `statement_timeout` raises when it fires. */
  QUERY_CANCELED: "57014",
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

function tenantFixture(
  tenantId: string,
  rawSecret: string,
): LangWatchQLTenantFixture {
  return {
    tenantId,
    rawSecret,
    // Derived through the production function rather than re-hashed here: the
    // key map only resolves a tenant when the two agree, and a fixture with its
    // own copy of the algorithm would drift into seeding a digest production
    // never computes — surfacing as every LangWatchQL read returning zero rows,
    // which is indistinguishable from a tenant that simply has no data. What
    // pins the digest to SHA-256 is a known-answer assertion, in
    // `tenantIsolation.integration.test.ts`.
    keyHash: lwqlTenantCapability({ secret: rawSecret }),
  };
}

export const TENANT_A = tenantFixture(
  "tenant-a",
  "raw-lwql-key-DO-NOT-LOG-abcdef123456",
);
export const TENANT_B = tenantFixture(
  "tenant-b",
  "raw-lwql-key-VICTIM-DO-NOT-LOG-fedcba654321",
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

/** The LangWatchQL fact tables and the column each row policy filters on. */
export const LWQL_FACT_TABLES: LangWatchQLTable[] = [
  { table: "traces", tenantColumn: "TenantId" },
  { table: "spans", tenantColumn: "TenantId" },
];

/**
 * The fixture fact tables as REAL LangWatchQL view definitions (#8258).
 *
 * The toy tables (`traces`, `spans`) are not in the shipped catalog, so a suite
 * that wants them policed registers them as ordinary view definitions in the
 * `views` input to {@link buildLwqlAccessModelDefinition} — the grant and policy
 * shape is then whatever the single emitter ({@link renderLwqlAccessModelDdl})
 * produces, with no test-local statement builders. `name === sourceTable`, so
 * the emitter's whole-object view grant lands on the fixture table itself (the
 * whole-table grant the fixture path wants; see {@link startLangWatchQLClickHouse}).
 */
const LWQL_FIXTURE_VIEWS: LangWatchQLViewDefinition[] = LWQL_FACT_TABLES.map(
  (table): LangWatchQLViewDefinition => ({
    name: table.table,
    sourceTable: table.table,
    description: `harness fixture view over ${table.table}`,
    gates: [],
    grain: `one ${table.table} row`,
    grainColumns: ["TenantId"],
    joinKeys: [],
    freshness: "test",
    tenantColumn:
      table.tenantColumn === "TenantId" ? undefined : table.tenantColumn,
    dedup: { strategy: "none", keyColumns: ["TenantId"] },
    columns: [
      {
        name: "TenantId",
        type: "String",
        description: "owning tenant",
        gates: [],
        sourceColumns: [table.tenantColumn],
      },
    ],
  }),
);

/**
 * The named-collection stub the harness carries in a definition when it is not
 * rendering the collection itself (only {@link renderLwqlNamedCollectionDdl}
 * reads it, and the access-model emitter ignores it).
 */
const HARNESS_NAMED_COLLECTION_STUB = {
  collection: "lwql_postgres",
  host: "unused",
  port: 0,
  database: "unused",
  user: "unused",
  password: "unused",
} as const;

/** The sha256 hex the restricted user is identified by (never the plaintext). */
const RESTRICTED_PASSWORD_SHA256_HEX = (): string =>
  createHash("sha256").update(RESTRICTED_PASSWORD).digest("hex");

/**
 * Where the fact tables the proof reads come from.
 *
 * `fixture` is two toy `MergeTree` tables created by this harness — enough to
 * prove row policies, grants and settings behave, and deliberately unlike the
 * real schema so nothing about the real schema can be inferred from it passing.
 *
 * `migrated` runs the *shipped* ClickHouse migrations into the container and
 * seeds the real `trace_summaries` / `stored_spans` / `evaluation_runs` /
 * `simulation_runs` — the tables the LangWatchQL views are built over. Anything
 * about deduplication, partition pruning or column types is only meaningful
 * against these: a `MergeTree` fixture has no versions to collapse and one
 * partition to prune.
 */
export type LangWatchQLFactTableMode = "fixture" | "migrated";

export interface LangWatchQLClickHouseHarness {
  names: LangWatchQLNames;
  /** Administrative client. Reads `system.*`, seeds fixtures, runs audits. */
  admin: ClickHouseClient;
  tenantA: LangWatchQLTenantFixture;
  tenantB: LangWatchQLTenantFixture;
  lwqlTables: LangWatchQLTable[];
  /**
   * Database holding the fact tables the LangWatchQL views read.
   *
   * The LangWatchQL database under `fixture`; a separate migrated database under
   * `migrated`, because the shipped migrations own every table in the database
   * they run against and would collide with the LangWatchQL objects.
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
  /**
   * Renders the whole access model from one definition and applies it, exactly
   * as production does (#8258). Run after the views exist. `views` overrides the
   * base fixtures outright; `extraViews` appends the suite's own view
   * definitions; `limits` re-provisions the settings profile; `sourceDatabase`
   * overrides where the source tables live. Idempotent, so a suite reconverges
   * a detached policy by calling it again.
   */
  applyAccessModel(opts?: {
    views?: readonly LangWatchQLViewDefinition[];
    extraViews?: readonly LangWatchQLViewDefinition[];
    limits?: LangWatchQLResourceLimits;
    sourceDatabase?: string;
  }): Promise<void>;
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
 * database first, and the access model is provisioned with no LangWatchQL tables
 * of its own — the caller applies `lwqlViewSetupStatements` over the
 * migrated tables instead. The whole-table grant the fixture path issues would
 * otherwise sit *underneath* the column-scoped one and quietly widen it back
 * out, since ClickHouse grants are additive.
 *
 * `extraConfigFiles` copies additional server config into the container (a
 * `users.d`/`config.d` file defining an LWQL entity in the read-only config
 * store, say), and folds each file's content into the reuse-hash label so a
 * changed file never reuses a container running the previous config.
 */
export async function startLangWatchQLClickHouse({
  suite,
  facts = "fixture",
  extraConfigFiles = [],
}: {
  suite: string;
  facts?: LangWatchQLFactTableMode;
  /** Extra server config files to install before ClickHouse starts. */
  extraConfigFiles?: Array<{ name: string; target: string; contents: string }>;
}): Promise<LangWatchQLClickHouseHarness> {
  const names = lwqlNamesForSuite(suite);
  const accessManagementXml = clickHouseAccessManagementConfigXml({
    administrativeUser: ADMIN_USER,
  });
  const configDigest = extraConfigFiles
    .reduce(
      (hash, file) => hash.update(file.target).update(file.contents),
      createHash("sha256")
        .update(CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML)
        .update(accessManagementXml),
    )
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
        source: writeConfigFile(
          configDirectory,
          "access-management.xml",
          accessManagementXml,
        ),
        target: CLICKHOUSE_ACCESS_MANAGEMENT_CONFIG_PATH,
      },
      ...extraConfigFiles.map((file) => ({
        source: writeConfigFile(configDirectory, file.name, file.contents),
        target: file.target,
      })),
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
  const lwqlTables = facts === "migrated" ? [] : LWQL_FACT_TABLES;

  if (facts === "migrated") {
    await runShippedMigrations({ container, database: factDatabase });
  } else {
    await applyAsAdmin(
      Object.entries(FACT_TABLE_DDL).map(
        ([table, ddl]) => `CREATE TABLE ${names.database}.${table} ${ddl}`,
      ),
    );
  }

  // The fixture fact tables, registered as real view definitions so the emitter
  // polices them like any catalog source (#8258). Empty under `migrated`: the
  // real catalog's views are applied later by the suite through
  // `applyAccessModel`.
  const baseViews: LangWatchQLViewDefinition[] =
    facts === "migrated" ? [] : LWQL_FIXTURE_VIEWS;

  /**
   * Renders the whole access model from ONE definition and applies it, exactly
   * as production does (profile → user → row policies → grants, from
   * {@link renderLwqlAccessModelDdl}). Run after the views exist. `views`
   * overrides the base fixtures outright; `extraViews` appends to them; both
   * default to the base fixtures. Idempotent (`OR REPLACE`), so a suite that
   * detaches one policy to prove it load-bearing reconverges the model by
   * calling this again. `sourceDatabase` mirrors provisionLwql.ts — one database
   * feeds the setup and view statements, so the key map (and its policies) live
   * in the facts database, not always names.database.
   */
  const applyAccessModel = async (opts?: {
    views?: readonly LangWatchQLViewDefinition[];
    extraViews?: readonly LangWatchQLViewDefinition[];
    limits?: LangWatchQLResourceLimits;
    sourceDatabase?: string;
  }): Promise<void> => {
    const definition = buildLwqlAccessModelDefinition({
      names,
      passwordSha256Hex: RESTRICTED_PASSWORD_SHA256_HEX(),
      namedCollection: HARNESS_NAMED_COLLECTION_STUB,
      sourceDatabase: opts?.sourceDatabase ?? factDatabase,
      ...(opts?.limits ? { limits: opts.limits } : {}),
      views: opts?.views ?? [...baseViews, ...(opts?.extraViews ?? [])],
    });
    await applyAsAdmin(renderLwqlAccessModelDdl(definition));
  };

  // The setup statements carry only the structural objects; the access model is
  // single-sourced from the definition above.
  await applyAsAdmin(
    lwqlClickHouseSetupStatements({ names, sourceDatabase: factDatabase }),
  );
  await applyAccessModel();

  await seedKeyMap({ admin, names, keyMapDatabase: factDatabase });
  if (facts === "migrated") {
    await seedRealFactRows({ admin, database: factDatabase });
  } else {
    await seedTenantRows({ admin, names });
  }

  const harness: LangWatchQLClickHouseHarness = {
    names,
    admin,
    tenantA: TENANT_A,
    tenantB: TENANT_B,
    lwqlTables,
    factDatabase,
    container,
    applyAsAdmin,
    applyAccessModel,
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
  keyMapDatabase,
}: {
  admin: ClickHouseClient;
  names: LangWatchQLNames;
  /** Where the key map table was provisioned; see the sourceDatabase comment above. */
  keyMapDatabase: string;
}): Promise<void> {
  await admin.insert({
    table: `${keyMapDatabase}.${names.keyMapTable}`,
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
// The real fact tables
// ---------------------------------------------------------------------------

/** Fact tables the LangWatchQL views read, by the name the migrations give them. */
export const REAL_FACT_TABLES = [
  "trace_summaries",
  "stored_spans",
  "evaluation_runs",
  "simulation_runs",
  "trace_analytics",
  "trace_analytics_rollup",
  "evaluation_analytics",
  "evaluation_analytics_rollup",
  "coding_agent_sessions",
  "coding_agent_session_events",
  "instant_eval_judgments",
] as const;

/**
 * Runs the shipped ClickHouse migrations into their own database.
 *
 * Its own, not the LangWatchQL one: the migrations own every table in the database
 * they run against, and the LangWatchQL database holds the key map and the views.
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

/**
 * The evaluation seeded twice, its two versions carrying two *sort keys*.
 *
 * `evaluation_analytics` sorts by `(TenantId, OccurredAt, EvaluationId)` and its
 * fold writes a moving progress watermark into `OccurredAt`, so a second
 * lifecycle event does not supersede the first row — it writes a row the engine
 * files under a different key. `FINAL` merges by that key and nothing else, so
 * it returns both, and every `count`, `sum` and `avg` over the dataset counts
 * this evaluation twice while looking entirely healthy.
 *
 * The two versions are a partition apart as well as a key apart, so the case
 * also covers a dedup shape that resolves the latest version only within one
 * partition.
 */
export const EVALUATION_DEDUP_FIXTURE = {
  evaluationIdSuffix: "dedup-eval",
  staleWeek: 0,
  latestWeek: SEED_WEEK_COUNT - 1,
  staleScore: 0.11,
  latestScore: 0.97,
  staleDurationMs: 13,
  latestDurationMs: 26,
  staleUpdatedAt: "2026-03-02 00:00:00.000",
  latestUpdatedAt: "2026-03-02 00:00:01.000",
} as const;

/** The evaluation id the moving-sort-key dedup fixture uses for a tenant. */
export function evaluationDedupId(tenantId: string): string {
  return `${tenantId}-${EVALUATION_DEDUP_FIXTURE.evaluationIdSuffix}`;
}

/**
 * One bucket of a rollup, written as two partial rows in two parts.
 *
 * The shape an `AggregatingMergeTree` is for and the one a reader can get
 * wrong: neither part is the answer, and the answer is not the later of them
 * either — it is their sum. Written in two inserts with merges stopped, so a
 * view that forgot to merge returns two rows and a view that picked a winner
 * returns the wrong total, and neither can pass by accident.
 *
 * The bucket sits inside the last seeded week, so it is in the same partition
 * the "recent" queries read and shares their retention.
 */
export const ROLLUP_MERGE_FIXTURE = {
  bucketStart: "2026-02-23 00:01:00.000",
  model: "gpt-5-rollup-merge",
  spanType: "llm",
  evaluatorType: "rollup_merge_judge",
  status: "processed",
  /**
   * The two parts of the trace bucket, keyed by the column each value is
   * written to.
   *
   * Every measure carries a different number, in both parts and therefore in
   * the total — which is the difference between proving the view merges and
   * proving it merges *the right column*. Feeding the same number to two
   * same-typed columns, as this fixture used to, means a view whose
   * `TraceCount` reads `SpanCount` returns exactly what the assertion expects.
   */
  traceParts: [
    {
      SpanCount: 7,
      TraceCount: 5,
      ErrorCount: 1,
      CostSum: 0.5,
      NonBilledCostSum: 0.125,
      DurationSum: 900,
      PromptTokensSum: 130,
      CompletionTokensSum: 45,
      CacheReadTokensSum: 22,
      CacheWriteTokensSum: 11,
      ReasoningTokensSum: 60,
    },
    {
      SpanCount: 6,
      TraceCount: 4,
      ErrorCount: 2,
      CostSum: 0.25,
      NonBilledCostSum: 0.0625,
      DurationSum: 400,
      PromptTokensSum: 90,
      CompletionTokensSum: 35,
      CacheReadTokensSum: 18,
      CacheWriteTokensSum: 9,
      ReasoningTokensSum: 70,
    },
  ],
  /** The two parts of the evaluation bucket, on the same rule. */
  evaluationParts: [
    {
      EvalCount: 20,
      PassCount: 11,
      FailCount: 5,
      ErrorCount: 3,
      SkippedCount: 1,
      ScoreSum: 12.5,
      ScoreCount: 16,
      DurationSum: 640,
      CostSum: 0.5,
      NonBilledCostSum: 0.125,
    },
    {
      EvalCount: 14,
      PassCount: 8,
      FailCount: 4,
      ErrorCount: 2,
      SkippedCount: 0,
      ScoreSum: 6.25,
      ScoreCount: 12,
      DurationSum: 320,
      CostSum: 0.25,
      NonBilledCostSum: 0.0625,
    },
  ],
} as const;

/**
 * What each merged bucket must add up to, stated rather than summed from the
 * parts — the arithmetic is the claim, and a test that derives it from the same
 * numbers it seeds only proves that addition works.
 *
 * Every measure of a rollup appears here, and the suite pins that: a measure
 * added to the catalog with no total to check against would otherwise be a
 * column nothing ever reads back.
 */
export const ROLLUP_MERGE_TOTALS: {
  readonly trace: Readonly<Record<string, number>>;
  readonly modelUsage: Readonly<Record<string, number>>;
  readonly evaluation: Readonly<Record<string, number>>;
} = {
  trace: {
    SpanCount: 13,
    TraceCount: 9,
    ErrorCount: 3,
    CostSum: 0.75,
    NonBilledCostSum: 0.1875,
    DurationSum: 1_300,
    PromptTokensSum: 220,
    CompletionTokensSum: 80,
    CacheReadTokensSum: 40,
    CacheWriteTokensSum: 20,
    ReasoningTokensSum: 130,
  },
  // The span-fact subset of the same bucket: `model_usage_by_minute` keeps the
  // per-model breakdown and carries no trace-level measures.
  modelUsage: {
    SpanCount: 13,
    CostSum: 0.75,
    NonBilledCostSum: 0.1875,
    PromptTokensSum: 220,
    CompletionTokensSum: 80,
    CacheReadTokensSum: 40,
    CacheWriteTokensSum: 20,
    ReasoningTokensSum: 130,
  },
  evaluation: {
    EvalCount: 34,
    PassCount: 19,
    FailCount: 9,
    ErrorCount: 5,
    SkippedCount: 1,
    ScoreSum: 18.75,
    ScoreCount: 28,
    DurationSum: 960,
    CostSum: 0.75,
    NonBilledCostSum: 0.1875,
  },
};

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

  await admin.insert({
    table: `${database}.coding_agent_sessions`,
    format: "JSONEachRow",
    values: tenants.flatMap((tenant) =>
      weeks.map((week) => ({
        TenantId: tenant.tenantId,
        SessionId: `${tenant.tenantId}-coding-session-${week}`,
        SessionKeySource: "session_id",
        Version: "1",
        StartedAt: seedWeekStart(week),
        UpdatedAt: seedWeekStart(week),
        Agent: "claude_code",
        AgentVersion: "1.0.0",
        TraceIds: [`${tenant.tenantId}-trace-${week}-0`],
        FinalRequestId: `${tenant.tenantId}-final-request-${week}`,
        UserId: `${tenant.tenantId}-end-user`,
        TerminalType: "tmux",
        Entrypoint: "cli",
        ModelCalls: 3,
        ToolCalls: 5,
        SubAgents: 0,
        Prompts: 2,
        PromptChars: 480,
        ResponseChars: 900,
        CostUsd: 0.42,
        AgentReportedCostUsd: 0.4,
        Title: `${SEEDED_CONTENT.simulationMessage}/${tenant.tenantId}`,
      })),
    ),
  });

  await admin.insert({
    table: `${database}.coding_agent_session_events`,
    format: "JSONEachRow",
    values: tenants.flatMap((tenant) =>
      weeks.map((week) => ({
        TenantId: tenant.tenantId,
        SessionId: `${tenant.tenantId}-coding-session-${week}`,
        TimeUnixMs: seedWeekStart(week),
        RecordId: `${tenant.tenantId}-coding-event-${week}`.padEnd(64, "0"),
        EventKind: "model_call",
        Agent: "claude_code",
        SessionKeySource: "session_id",
        TraceId: `${tenant.tenantId}-trace-${week}-0`,
        SpanId: `${tenant.tenantId}-span-${week}-0`,
        QuerySource: "repl_main_thread",
        RequestId: `${tenant.tenantId}-final-request-${week}`,
        Model: SEEDED_DIMENSION_ATTRIBUTE.value,
        InputTokens: 100,
        OutputTokens: 20,
        CostUsd: 0.05,
      })),
    ),
  });

  // The one `claude_code.tool` span `coding_tool_results` reads, plus the
  // `api_request_body` log record its LEFT join can find. Seeded here (not in
  // the generic sweep below) because the two rows must correlate by TraceId,
  // not merely both exist.
  const toolTraceId = (tenantId: string) => `${tenantId}-tool-trace-0`;
  await admin.command({ query: `SYSTEM STOP MERGES ${database}.log_records` });
  await admin.command({ query: `TRUNCATE TABLE ${database}.log_records` });
  await admin.insert({
    table: `${database}.stored_spans`,
    format: "JSONEachRow",
    values: tenants.map((tenant) => ({
      ProjectionId: `${tenant.tenantId}/tool-span`,
      TenantId: tenant.tenantId,
      TraceId: toolTraceId(tenant.tenantId),
      SpanId: `${tenant.tenantId}-tool-span-0`,
      Sampled: 1,
      StartTime: seedWeekStart(SEED_WEEK_COUNT - 1),
      EndTime: seedWeekStart(SEED_WEEK_COUNT - 1),
      DurationMs: 40,
      SpanName: "claude_code.tool",
      SpanKind: 3,
      ServiceName: "api",
      ScopeName: "langwatch",
      ResourceAttributes: {},
      // Same captured-content keys every other seeded span carries: a bare
      // `LIMIT 1` with no `ORDER BY` elsewhere in this suite is free to read
      // this row first, and it must satisfy the same content assertions.
      SpanAttributes: {
        "langwatch.input": SEEDED_CONTENT.spanInput,
        "langwatch.output": SEEDED_CONTENT.spanOutput,
      },
      Cost: 0,
    })),
  });
  await admin.insert({
    table: `${database}.log_records`,
    format: "JSONEachRow",
    values: tenants.map((tenant) => ({
      TenantId: tenant.tenantId,
      CorrelationTraceId: toolTraceId(tenant.tenantId),
      TimeUnixMs: seedWeekStart(SEED_WEEK_COUNT - 1),
      RecordId: `${tenant.tenantId}-tool-log-record`.padEnd(64, "0"),
      EventName: "api_request_body",
      CorrelationSpanId: `${tenant.tenantId}-tool-span-0`,
      ProviderSessionId: `${tenant.tenantId}-coding-session-${SEED_WEEK_COUNT - 1}`,
      AttributesJson: JSON.stringify({
        body: JSON.stringify({
          messages: [
            {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: `${tenant.tenantId}-tool-span-0`,
                  content: SEEDED_CONTENT.spanOutput,
                },
              ],
            },
          ],
        }),
      }),
    })),
  });

  await seedRemainingDerivedSourceTables({ admin, database, tenants });
  await seedAnalyticsProjections({ admin, database, tenants, weeks });
}

/**
 * ClickHouse-resident source tables the catalog reads that carry no
 * hand-crafted fixture above and no `AggregateFunction` column — a plain
 * `ReplacingMergeTree` where "the isolation proof has a tenant-a row and a
 * tenant-b row" is the whole ask. One row per tenant, the physical tenant
 * column set (usually `TenantId`, `stored_objects` uses `project_id`),
 * everything else left to ClickHouse's own column defaults.
 *
 * Deliberately generic and driven off {@link LWQL_VIEW_CATALOG} rather than a
 * second hand-maintained table list: a table the catalog starts reading is
 * covered here automatically, the way it already is by
 * {@link runShippedMigrations}. The two `AggregateFunction`-bearing tables
 * (`gateway_budget_scope_totals`, `simulation_run_metrics_rollup`) are
 * excluded — no plain `INSERT` can populate an aggregate-state column, so
 * they get their own `*State()` seed below.
 */
const AGGREGATING_SOURCE_TABLES = new Set([
  "gateway_budget_scope_totals",
  "simulation_run_metrics_rollup",
]);

async function seedRemainingDerivedSourceTables({
  admin,
  database,
  tenants,
}: {
  admin: ClickHouseClient;
  database: string;
  tenants: readonly LangWatchQLTenantFixture[];
}): Promise<void> {
  const alreadySeeded = new Set([
    ...REAL_FACT_TABLES,
    "log_records",
    ...AGGREGATING_SOURCE_TABLES,
  ]);

  const remaining = new Set(
    LWQL_VIEW_CATALOG.filter((view) => !isPostgresResident(view))
      .map((view) => view.sourceTable)
      .filter((table) => !alreadySeeded.has(table)),
  );

  // Truncated first: a reused container carries whatever a previous run of
  // this same seed inserted, and re-seeding on top of untouched rows collides
  // two identical-key physical rows into the dedup views' output — the
  // `ReplacingMergeTree` only collapses them on a background merge, which
  // this suite never waits for.
  for (const table of [...remaining, ...AGGREGATING_SOURCE_TABLES]) {
    await admin.command({ query: `SYSTEM STOP MERGES ${database}.${table}` });
    await admin.command({ query: `TRUNCATE TABLE ${database}.${table}` });
  }

  for (const table of remaining) {
    const view = LWQL_VIEW_CATALOG.find(
      (candidate) => candidate.sourceTable === table,
    )!;
    const tenantColumn = lwqlPhysicalColumn(view, "TenantId");
    await admin.insert({
      table: `${database}.${table}`,
      format: "JSONEachRow",
      values: tenants.map((tenant) => ({
        [tenantColumn]: tenant.tenantId,
      })),
    });
  }

  // `gateway_budget_scope_totals` and `simulation_run_metrics_rollup`:
  // AggregatingMergeTree tables whose non-key columns are `AggregateFunction`
  // states — only reachable through the matching `*State()` combinator, never
  // a plain scalar `INSERT`.
  for (const tenant of tenants) {
    await admin.command({
      query:
        `INSERT INTO ${database}.gateway_budget_scope_totals ` +
        `(TenantId, Scope, ScopeId, Window, BudgetId, PeriodStart, SpendUSD, TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite, RequestCount, UpdatedAt, SpendNanoUSD) ` +
        `SELECT '${tenant.tenantId}', 'project', '${tenant.tenantId}', 'day', 'budget-1', now64(3), ` +
        `sumState(toDecimal64(1.5, 6)), sumState(toUInt64(100)), sumState(toUInt64(20)), sumState(toUInt64(5)), sumState(toUInt64(3)), countState(), now64(3), sumState(toInt64(1500000000))`,
    });
    await admin.command({
      query:
        `INSERT INTO ${database}.simulation_run_metrics_rollup ` +
        `(TenantId, ScenarioRunId, TraceId, TotalCost, RoleCosts, RoleLatencies, OccurredAt, PartitionMonth) ` +
        `SELECT '${tenant.tenantId}', '${tenant.tenantId}-sim-rollup', '${tenant.tenantId}-trace-rollup', ` +
        `argMaxState(toFloat64(0.5), now64(3)), argMaxState(map('assistant', 0.5), now64(3)), argMaxState(map('assistant', 120.0), now64(3)), maxState(now64(3)), toUInt32(202601)`,
    });
  }
}

/**
 * Seeds the analytics projections and their per-minute rollups.
 *
 * Same tenants, same weekly partitions and the same trace ids as the fold's
 * other projections, so a query that joins `trace_metrics` to `spans` on
 * `TraceId` finds rows on both sides rather than proving isolation against an
 * empty result.
 */
async function seedAnalyticsProjections({
  admin,
  database,
  tenants,
  weeks,
}: {
  admin: ClickHouseClient;
  database: string;
  tenants: readonly { tenantId: string }[];
  weeks: readonly number[];
}): Promise<void> {
  const traceAnalyticsRow = ({
    tenantId,
    traceId,
    occurredAt,
    updatedAt,
    durationMs,
  }: {
    tenantId: string;
    traceId: string;
    occurredAt: string;
    updatedAt: string;
    durationMs: number;
  }) => ({
    TenantId: tenantId,
    TraceId: traceId,
    Version: "1",
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: updatedAt,
    TraceName: `trace ${traceId}`,
    TopicId: "checkout",
    SubTopicId: null,
    UserId: `${tenantId}-end-user`,
    ConversationId: `${tenantId}-thread`,
    CustomerId: `${tenantId}-customer`,
    Origin: "sdk",
    Models: [SEEDED_DIMENSION_ATTRIBUTE.value],
    Labels: ["checkout"],
    TotalCost: 0.0042,
    NonBilledCost: 0.0001,
    TotalDurationMs: durationMs,
    TimeToFirstTokenMs: 120,
    TokensPerSecond: 42,
    PromptTokens: 100,
    CompletionTokens: 20,
    CacheReadTokens: 5,
    CacheWriteTokens: 3,
    ReasoningTokens: 7,
    HasError: false,
    HasAnnotation: null,
    // The same content key the other projections carry, so "the map is
    // filtered" is a claim with something to filter.
    Attributes: {
      [SEEDED_DIMENSION_ATTRIBUTE.key]: SEEDED_DIMENSION_ATTRIBUTE.value,
      "gen_ai.prompt": SEEDED_CONTENT.spanPromptAttribute,
    },
  });

  await admin.insert({
    table: `${database}.trace_analytics`,
    format: "JSONEachRow",
    values: tenants.flatMap((tenant) =>
      weeks.flatMap((week) =>
        [...Array(SEED_TRACES_PER_WEEK).keys()].map((index) =>
          traceAnalyticsRow({
            tenantId: tenant.tenantId,
            traceId: `${tenant.tenantId}-trace-${week}-${index}`,
            occurredAt: seedWeekStart(week),
            updatedAt: seedWeekStart(week),
            durationMs: 1200,
          }),
        ),
      ),
    ),
  });

  // Two versions in two parts, so `FINAL` has something to collapse here too.
  for (const updatedAt of [
    DEDUP_FIXTURE.staleUpdatedAt,
    DEDUP_FIXTURE.latestUpdatedAt,
  ]) {
    await admin.insert({
      table: `${database}.trace_analytics`,
      format: "JSONEachRow",
      values: tenants.map((tenant) =>
        traceAnalyticsRow({
          tenantId: tenant.tenantId,
          traceId: dedupTraceId(tenant.tenantId),
          occurredAt: seedWeekStart(SEED_WEEK_COUNT - 1),
          updatedAt,
          durationMs:
            updatedAt === DEDUP_FIXTURE.latestUpdatedAt
              ? DEDUP_FIXTURE.latestSpanCount
              : DEDUP_FIXTURE.staleSpanCount,
        }),
      ),
    });
  }

  const evaluationAnalyticsRow = ({
    tenantId,
    evaluationId,
    traceId,
    occurredAt,
    updatedAt,
    score,
    durationMs = 340,
  }: {
    tenantId: string;
    evaluationId: string;
    traceId: string;
    occurredAt: string;
    updatedAt: string;
    score: number;
    durationMs?: number;
  }) => ({
    TenantId: tenantId,
    EvaluationId: evaluationId,
    Version: "1",
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: updatedAt,
    EvaluatorType: "llm_judge",
    EvaluatorName: "Quality",
    Status: "processed",
    IsGuardrail: false,
    Passed: true,
    Score: score,
    Label: "good",
    Model: SEEDED_DIMENSION_ATTRIBUTE.value,
    TraceId: traceId,
    UserId: `${tenantId}-end-user`,
    ConversationId: `${tenantId}-thread`,
    CustomerId: `${tenantId}-customer`,
    Origin: "sdk",
    DurationMs: durationMs,
    TotalCost: 0.0009,
    NonBilledCost: 0.0,
    Attributes: {
      [SEEDED_DIMENSION_ATTRIBUTE.key]: SEEDED_DIMENSION_ATTRIBUTE.value,
      "gen_ai.prompt": SEEDED_CONTENT.spanPromptAttribute,
    },
  });

  await admin.insert({
    table: `${database}.evaluation_analytics`,
    format: "JSONEachRow",
    values: tenants.flatMap((tenant) =>
      weeks.flatMap((week) =>
        [...Array(SEED_EVALUATIONS_PER_WEEK).keys()].map((index) =>
          evaluationAnalyticsRow({
            tenantId: tenant.tenantId,
            evaluationId: `${tenant.tenantId}-eval-${week}-${index}`,
            traceId: `${tenant.tenantId}-trace-${week}-${index}`,
            occurredAt: seedWeekStart(week),
            updatedAt: seedWeekStart(week),
            score: 0.8,
          }),
        ),
      ),
    ),
  });

  // The two versions of one evaluation, each carrying its own `OccurredAt` —
  // the fold's watermark having moved between them — so they are two sort keys
  // rather than two versions of one, and a separate insert each so the engine
  // has two parts to reconcile.
  for (const version of [
    {
      week: EVALUATION_DEDUP_FIXTURE.staleWeek,
      updatedAt: EVALUATION_DEDUP_FIXTURE.staleUpdatedAt,
      score: EVALUATION_DEDUP_FIXTURE.staleScore,
      durationMs: EVALUATION_DEDUP_FIXTURE.staleDurationMs,
    },
    {
      week: EVALUATION_DEDUP_FIXTURE.latestWeek,
      updatedAt: EVALUATION_DEDUP_FIXTURE.latestUpdatedAt,
      score: EVALUATION_DEDUP_FIXTURE.latestScore,
      durationMs: EVALUATION_DEDUP_FIXTURE.latestDurationMs,
    },
  ]) {
    await admin.insert({
      table: `${database}.evaluation_analytics`,
      format: "JSONEachRow",
      values: tenants.map((tenant) =>
        evaluationAnalyticsRow({
          tenantId: tenant.tenantId,
          evaluationId: evaluationDedupId(tenant.tenantId),
          traceId: dedupTraceId(tenant.tenantId),
          occurredAt: seedWeekStart(version.week),
          updatedAt: version.updatedAt,
          score: version.score,
          durationMs: version.durationMs,
        }),
      ),
    });
  }

  await admin.insert({
    table: `${database}.trace_analytics_rollup`,
    format: "JSONEachRow",
    values: tenants.flatMap((tenant) =>
      weeks.map((week) => ({
        TenantId: tenant.tenantId,
        BucketStart: seedWeekStart(week),
        Model: SEEDED_DIMENSION_ATTRIBUTE.value,
        SpanType: "llm",
        SpanCount: SEED_TRACES_PER_WEEK,
        TraceCount: SEED_TRACES_PER_WEEK,
        ErrorCount: 0,
        CostSum: 1.05,
        NonBilledCostSum: 0.025,
        DurationSum: 300_000,
        PromptTokensSum: 25_000,
        CompletionTokensSum: 5_000,
        CacheReadTokensSum: 1_250,
        CacheWriteTokensSum: 750,
        ReasoningTokensSum: 1_750,
      })),
    ),
  });

  await admin.insert({
    table: `${database}.evaluation_analytics_rollup`,
    format: "JSONEachRow",
    values: tenants.flatMap((tenant) =>
      weeks.map((week) => ({
        TenantId: tenant.tenantId,
        BucketStart: seedWeekStart(week),
        EvaluatorType: "llm_judge",
        Status: "processed",
        EvalCount: SEED_EVALUATIONS_PER_WEEK,
        PassCount: SEED_EVALUATIONS_PER_WEEK,
        FailCount: 0,
        ErrorCount: 0,
        SkippedCount: 0,
        ScoreSum: 20,
        ScoreCount: SEED_EVALUATIONS_PER_WEEK,
        DurationSum: 8_500,
        CostSum: 0.0225,
        NonBilledCostSum: 0,
      })),
    ),
  });

  // One insert per part, so the bucket really is two rows on disk rather than
  // one the client summed on the way in. Each part is spread by column name,
  // so what the fixture says a measure is and what lands in that measure's
  // column are the same statement.
  for (const part of ROLLUP_MERGE_FIXTURE.traceParts) {
    await admin.insert({
      table: `${database}.trace_analytics_rollup`,
      format: "JSONEachRow",
      values: tenants.map((tenant) => ({
        TenantId: tenant.tenantId,
        BucketStart: ROLLUP_MERGE_FIXTURE.bucketStart,
        Model: ROLLUP_MERGE_FIXTURE.model,
        SpanType: ROLLUP_MERGE_FIXTURE.spanType,
        ...part,
      })),
    });
  }

  // One judgement per seeded trace, per tenant: the judgments view reads this
  // table, and an isolation assertion over a view whose table is empty proves
  // nothing.
  await admin.insert({
    table: `${database}.instant_eval_judgments`,
    format: "JSONEachRow",
    values: tenants.flatMap((tenant) =>
      weeks.flatMap((week) =>
        [...Array(SEED_TRACES_PER_WEEK).keys()].map((index) => ({
          TenantId: tenant.tenantId,
          RunId: `${tenant.tenantId}-instant-eval-run`,
          TraceId: `${tenant.tenantId}-trace-${week}-${index}`,
          QuestionId: "annoyed",
          ThreadId: "",
          SpanId: "",
          Kind: "boolean",
          Status: "judged",
          Passed: index % 2,
          Score: null,
          Label: "",
          Probability: 0.5 + index / 100,
          Probabilities: "",
          Error: "",
          OccurredAt: seedWeekStart(week),
          CreatedAt: seedWeekStart(week),
          UpdatedAt: seedWeekStart(week),
        })),
      ),
    ),
  });

  for (const part of ROLLUP_MERGE_FIXTURE.evaluationParts) {
    await admin.insert({
      table: `${database}.evaluation_analytics_rollup`,
      format: "JSONEachRow",
      values: tenants.map((tenant) => ({
        TenantId: tenant.tenantId,
        BucketStart: ROLLUP_MERGE_FIXTURE.bucketStart,
        EvaluatorType: ROLLUP_MERGE_FIXTURE.evaluatorType,
        Status: ROLLUP_MERGE_FIXTURE.status,
        ...part,
      })),
    });
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** What one query cost, read back from the server's own accounting. */
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
  names: LangWatchQLNames;
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
const PG_READER_PASSWORD = "lwql-pg-reader-test-password";
const PG_ADMIN_USER = "test";
const PG_ADMIN_PASSWORD = "test";
const PG_DATABASE = "lwtest";
const PG_SCHEMA = "public";

/**
 * The named collection this suite's engine tables read through.
 *
 * Per-suite for the same reason `lwqlNamesForSuite` exists: named
 * collections are server-global, and CI runs integration files two at a time
 * against one ClickHouse server. Under a shared name, each suite's
 * DROP + CREATE repoints the collection at its own PostgreSQL container —
 * the neighbour's engine tables silently read the wrong database, or lose
 * the collection entirely mid-run. (Shipped provisioning keeps one fixed
 * name; a deployment has one PostgreSQL, not one per suite.)
 */
export function lwqlTestNamedCollection(names: LangWatchQLNames): string {
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
/** The PostgreSQL-engine table behind it, inside the LangWatchQL database. */
export const PG_MAPPED_TABLE = mappedCatalogEntry(PG_MAPPED_VIEW).sourceTable;
/** The tenant column, which every approved view exposes under the same name. */
export const PG_MAPPED_TENANT_COLUMN = "TenantId";
/**
 * The exposed name of a base-relation column the approved view leaves out.
 *
 * `Annotation.email` is a person identifier the catalog strips (a `comment` is
 * now *gated* rather than absent, so it no longer proves unreachability). Its
 * exposed name would be `Email`; the view omits it, so a `SELECT "Email"` over
 * the view is an unknown identifier. Taken from the real model rather than a
 * synthetic column, so the proof is about the shipped exclusion policy.
 */
export const PG_EXCLUDED_COLUMN = "Email";

/** One PostgreSQL-resident catalog entry, by the name a caller writes. */
function mappedCatalogEntry(
  name: string,
): LangWatchQLViewDefinition & { postgres: LangWatchQLPostgresMapping } {
  const entry = lwqlPostgresViews(LWQL_VIEW_CATALOG).find(
    (view) => view.name === name,
  );
  if (!entry) {
    throw new Error(
      `lwql harness: "${name}" is not a PostgreSQL-resident dataset in the shipped catalog`,
    );
  }
  return entry;
}

export interface PostgresExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface LangWatchQLPostgresHarness {
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
 * Where Prisma keeps the application migrations, resolved from the directory the
 * tests run in (`platform/app`), exactly as `lwqlCatalogCollision.unit.test.ts`
 * resolves the ClickHouse ones.
 */
const PG_MIGRATIONS_DIR = join(process.cwd(), "prisma/migrations");

/**
 * Every application migration concatenated in apply order, as one SQL script.
 *
 * The real schema, not a hand-written stand-in: the catalog is *derived* from
 * the application's models now, so a base relation the derivation names — a
 * column, a NOT NULL, an enum, a `@map`'d name — must be the shipped one or the
 * proof proves nothing. Prisma migrations are plain SQL, so replaying them
 * through `psql -f` reproduces exactly what production runs.
 *
 * `0_init` sorts before the timestamped directories ('0' < '2'), which is the
 * order Prisma applies them; `migration_lock.toml` is a file, not a directory,
 * so filtering to directories drops it without a special case.
 */
function concatenatedPrismaMigrations(): string {
  const directories = readdirSync(PG_MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (directories.length === 0) {
    throw new Error(
      `lwql harness: no Prisma migrations found under ${PG_MIGRATIONS_DIR}`,
    );
  }
  return directories
    .map(
      (directory) =>
        `-- migration: ${directory}\n${readFileSync(
          join(PG_MIGRATIONS_DIR, directory, "migration.sql"),
          "utf8",
        )}`,
    )
    .join("\n\n");
}

/**
 * LangWatchQL databases that map this one PostgreSQL role at the same time.
 *
 * Container reuse is what makes this more than one: every suite that maps the
 * PostgreSQL half gets its own LangWatchQL database inside the *same* reused
 * ClickHouse server, and each of those databases holds its own connection pool
 * per mapped table against the same role. Sized for one catalog, the role's cap
 * is exhausted by idle pooled connections from the suites that ran before, and
 * the failure is a refused login rather than a queue.
 *
 * Production maps one catalog from one deployment, which is the function's
 * default.
 */
const LWQL_TEST_CONCURRENT_CATALOGS = 6;

/** The role's cap in this harness, so a test can assert the value that was set. */
export const LWQL_TEST_POSTGRES_CONNECTION_LIMIT =
  lwqlPostgresReaderConnectionLimit({
    concurrentCatalogs: LWQL_TEST_CONCURRENT_CATALOGS,
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
  // Column-named against the real, migrated Annotation table (it now has far
  // more columns than the six the fixture fills, all nullable). No parent
  // Project/Team/Organization rows for the filler tenants: the Annotation
  // table's parent relations are `relationMode = "prisma"`, enforced in
  // application code rather than by a database foreign key, so an orphan
  // Annotation inserts cleanly.
  `INSERT INTO ${PG_SCHEMA}."Annotation" ` +
    `("id", "projectId", "traceId", "isThumbsUp", "comment", "email", "createdAt", "updatedAt") ` +
    `SELECT 'filler-note-' || g, 'filler-tenant-' || (g % ${PG_LOAD_FIXTURE_TENANTS}), ` +
    `'filler-trace-' || g, true, 'comment of filler', 'excluded-email-of-filler', ` +
    `now(), now() ` +
    `FROM generate_series(1, ${PG_LOAD_FIXTURE_TENANTS * PG_LOAD_FIXTURE_ROWS_PER_TENANT}) g`,
  `CREATE INDEX IF NOT EXISTS "Annotation_projectId_idx" ON ${PG_SCHEMA}."Annotation" ("projectId")`,
  `ANALYZE ${PG_SCHEMA}."Annotation"`,
];

/**
 * The models {@link postgresTenantSeedStatements} hand-seeds, so the generic
 * {@link postgresModelSeedStatements} skips them rather than seeding a second,
 * colliding row. `Organization`, `Team` and `User` are the tenancy spine (never
 * derived into a view); the rest are the six formerly-hand-written views plus
 * the two organization-fan-out fixtures (`Topic`, `VirtualKey`).
 */
export const LWQL_EXPLICITLY_SEEDED_MODELS = [
  "Organization",
  "Team",
  "User",
  "Project",
  "Annotation",
  "Experiment",
  "BatchEvaluation",
  "LlmPromptConfig",
  "LlmPromptConfigVersion",
  "Topic",
  "VirtualKey",
] as const;

/**
 * The whole derived Postgres catalog, computed once from the same manifest,
 * skip map and overrides the shipped catalog is built from.
 *
 * Shared between {@link postgresTenantSeedStatements} (every generic caller's
 * seed) and {@link startLangWatchQLPostgres} (the view/reader-role setup), so
 * the two never derive it separately and drift.
 */
const LWQL_HARNESS_DERIVED_POSTGRES_VIEWS =
  LWQL_POSTGRES_CATALOG as readonly DerivedPostgresView[];

/**
 * One tenant's rows in every mapped base relation, followed by one row per
 * every *other* derived view's base model (the generic seed).
 *
 * Parameterized rather than fixed to the two harness fixtures because the
 * endpoint suites authenticate as *real project ids* and need PostgreSQL rows
 * under those, exactly as they already seed their own ClickHouse rows. Every
 * relation for every tenant, so that an isolation assertion always has
 * something it could have leaked.
 *
 * Excluded columns carry a recognisable `excluded-` marker, which is what lets
 * a test assert the *data* never reached the LangWatchQL schema rather than only
 * that the column name was refused.
 *
 * `traceIds` ties annotations to whatever traces the caller seeded on the
 * ClickHouse side, so an annotation-to-trace join has matching rows; the
 * default is the shape the isolation suite seeds.
 *
 * The generic seed runs last (its rows may reference the explicit ones as
 * foreign keys) and skips {@link LWQL_EXPLICITLY_SEEDED_MODELS} so a model
 * this function already inserted never gets a second, colliding row. Every
 * caller of this function — not only {@link startLangWatchQLPostgres} — needs
 * this, since `postgresEngineIsolation.integration.test.ts` and friends read
 * every derived view's engine table and would otherwise find nothing seeded
 * for the ~85 views the explicit seed above does not cover.
 */
export function postgresTenantSeedStatements({
  tenantId,
  organizationId = `${tenantId}-org`,
  teamId = `${tenantId}-team`,
  traceIds = [`${tenantId}-trace-1`, `${tenantId}-trace-2`],
  thumbsUp = [true, false],
  scores = [0.5, 0.9],
  promptId = `${tenantId}-prompt`,
  stamp = "2026-01-01T00:00:00Z",
}: {
  tenantId: string;
  /**
   * The organization this tenant's project hangs off. Defaults to a per-tenant
   * organization so every tenant is its own organization — which is what makes
   * the org fan-out negative test meaningful: the `virtual_keys` view derives
   * its TenantId by walking Organization → Team → Project, so a VirtualKey must
   * be visible under its own organization's project and no other's, and that is
   * only a claim if the two tenants sit in two organizations.
   */
  organizationId?: string;
  /** The team between the organization and the project. Defaults per tenant. */
  teamId?: string;
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
  // Column-named, because the tables are the migrated ones now: positional
  // VALUES would break the moment a migration adds a column, and every
  // identifier is quoted because Prisma emits mixed-case column names.
  const rows = (table: string, columns: string, values: string[]): string =>
    `INSERT INTO ${PG_SCHEMA}."${table}" (${columns}) VALUES ${values.join(", ")}`;
  const userId = `${tenantId}-user`;
  const verdict = (index: number): string => {
    const value = thumbsUp[index % thumbsUp.length];
    return value === null || value === undefined ? "NULL" : String(value);
  };
  const explicit: string[] = [
    // The tenancy spine: Organization → Team → Project. None of Organization,
    // Team or User is derived into a LangWatchQL view (identity / access-control
    // plumbing), so their column values never reach a view and carry no
    // `excluded-` markers — except the person identifier on User, which one day
    // might, and is marked so a leak is caught if it ever does.
    rows("Organization", '"id", "name", "slug"', [
      `('${organizationId}', 'Org ${tenantId}', '${organizationId}-slug')`,
    ]),
    rows("Team", '"id", "name", "slug", "organizationId"', [
      `('${teamId}', 'Team ${tenantId}', '${teamId}-slug', '${organizationId}')`,
    ]),
    rows("User", '"id", "email"', [
      `('${userId}', 'excluded-email-of-${tenantId}')`,
    ]),
    // The tenant IS the project id, exactly as before. `apiKey` and `lwqlKey`
    // are the two secret-material columns the catalog strips, so both carry the
    // marker; `lwqlKey` has a database default but is set explicitly so the
    // exclusion proof has a distinctive string to look for. Both are unique,
    // hence the per-tenant suffix.
    rows(
      "Project",
      '"id", "name", "slug", "apiKey", "lwqlKey", "teamId", "language", "framework"',
      [
        `('${tenantId}', 'Project ${tenantId}', '${tenantId}-slug', ` +
          `'excluded-apikey-of-${tenantId}', 'excluded-lwqlkey-of-${tenantId}', ` +
          `'${teamId}', 'python', 'openai')`,
      ],
    ),
    // One VirtualKey per organization. `hashedSecret` is stripped (secret
    // material) and marked; `displayPrefix` and `name` are exposed, so they must
    // NOT contain the marker. `createdById` points at the User above.
    rows(
      "VirtualKey",
      '"id", "organizationId", "name", "hashedSecret", "displayPrefix", "createdById"',
      [
        `('${tenantId}-vk', '${organizationId}', 'VK ${tenantId}', ` +
          `'excluded-hash-of-${organizationId}', 'vk-${tenantId}', '${userId}')`,
      ],
    ),
    // Two topics per project. `centroid`, `embeddings_model` and `p95Distance`
    // are the clustering internals the Topic override strips, so the model name
    // carries the marker; `name` is exposed and does not.
    rows(
      "Topic",
      '"id", "projectId", "name", "embeddings_model", "centroid", "p95Distance"',
      [1, 2].map(
        (index) =>
          `('${tenantId}-topic-${index}', '${tenantId}', 'Topic ${tenantId} ${index}', ` +
          `'excluded-model', '{}'::jsonb, 0.5)`,
      ),
    ),
    // `comment` is now *gated* (exposed to a caller with content access), not
    // stripped, so it must NOT carry the marker; `email` is still stripped as a
    // person identifier, so it keeps it.
    rows(
      "Annotation",
      '"id", "projectId", "traceId", "isThumbsUp", "comment", "email", "createdAt", "updatedAt"',
      traceIds.map(
        (traceId, index) =>
          `('${tenantId}-note-${index + 1}', '${tenantId}', '${traceId}', ${verdict(index)}, ` +
          `'comment of ${tenantId}', 'excluded-email-of-${tenantId}', ${at}, ${at})`,
      ),
    ),
    rows(
      "Experiment",
      '"id", "projectId", "name", "slug", "type", "workbenchState", "createdAt"',
      [
        `('${tenantId}-experiment', '${tenantId}', 'Experiment ${tenantId}', ` +
          `'${tenantId}-exp-slug', 'BATCH_EVALUATION_V2', '{"workbench":"state"}'::jsonb, ${at})`,
      ],
    ),
    rows(
      "BatchEvaluation",
      '"id", "projectId", "experimentId", "evaluation", "status", "score", "label", ' +
        '"passed", "cost", "datasetId", "datasetSlug", "details", "data", "createdAt", "updatedAt"',
      scores.map(
        (score, index) =>
          `('${tenantId}-run-${index + 1}', '${tenantId}', '${tenantId}-experiment', ` +
          `'exact_match', 'finished', ${score}, 'label-${index + 1}', ` +
          `${score >= 0.8}, ${index + 1}.25, 'dataset-${index + 1}', 'dataset-slug-${index + 1}', ` +
          `'details of ${tenantId}', '{"rows":"data"}'::jsonb, ${at}, ${at})`,
      ),
    ),
    rows(
      "LlmPromptConfig",
      '"id", "projectId", "organizationId", "name", "handle", "createdAt"',
      [
        `('${promptId}', '${tenantId}', '${organizationId}', 'Prompt ${tenantId}', ` +
          `'${tenantId}/handle', ${at})`,
      ],
    ),
    rows(
      "LlmPromptConfigVersion",
      // `config` is the database column `configData` is `@map`'d to.
      '"id", "projectId", "configId", "version", "commitMessage", "config", "schemaVersion", "createdAt"',
      [1, 2].map(
        (version) =>
          `('${promptId}-v${version}', '${tenantId}', '${promptId}', ` +
          `${version}, 'commit of ${tenantId}', '{"prompt":"text"}'::jsonb, '1', ${at})`,
      ),
    ),
  ];
  // Every other derived view's base model, generated from the manifest, after
  // the explicit seeds so a foreign key to one of those (e.g. a VirtualKey or
  // a prompt) points at a row that already exists.
  return [
    ...explicit,
    ...postgresModelSeedStatements({
      tenantId,
      organizationId,
      teamId,
      userId,
      views: LWQL_HARNESS_DERIVED_POSTGRES_VIEWS,
      manifest: LWQL_PRISMA_MANIFEST,
      alreadySeeded: LWQL_EXPLICITLY_SEEDED_MODELS,
      // `promptId` is caller-chosen, so a generic row's foreign key to
      // `LlmPromptConfig`/`LlmPromptConfigVersion` must point at the id this
      // call's explicit seed actually wrote above, not the fixed
      // `<tenant>-prompt`/`<tenant>-prompt-v1` convention.
      explicitIds: {
        LlmPromptConfig: promptId,
        LlmPromptConfigVersion: `${promptId}-v1`,
      },
      schema: PG_SCHEMA,
    }),
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
 * The setup replays the whole Prisma migration history into a fresh database
 * and then seeds a fixed set of rows in a fixed schema. Reuse hands every caller
 * the same container, so with `VITEST_INTEGRATION_PARALLEL=1` (CI,
 * `maxWorkers: 2`) two suites would replay those migrations on top of each
 * other — the second `CREATE TABLE`/`CREATE TYPE` losing to the first with
 * `42P07`/`42710: already exists`. The ClickHouse half is safe because each
 * suite gets its own LangWatchQL database; the PostgreSQL half has no such
 * per-suite name, so isolation comes from the container. A private container
 * per suite costs a few seconds and removes the race by construction.
 */
export async function startLangWatchQLPostgres(): Promise<LangWatchQLPostgresHarness> {
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
          `lwql PostgreSQL setup failed (${result.exitCode}) for:\n${sql}\n${result.stderr}`,
        );
      }
    }
  };

  const mapped = mappedCatalogEntry(PG_MAPPED_VIEW);

  // The real schema, built by replaying the whole migration history in one
  // `psql -f`. One connection, one script — far cheaper than one exec per
  // migration — and it runs BEFORE `log_statement='all'` below so the hundreds
  // of migration statements never land in the log the rowsRead measurements
  // read. `ON_ERROR_STOP=1` makes psql exit non-zero on the first failing
  // statement, which the check below turns into a named error rather than a
  // schema that is silently missing half its tables.
  await container.copyContentToContainer([
    {
      content: concatenatedPrismaMigrations(),
      target: "/tmp/lwql-migrations.sql",
    },
  ]);
  const migration = await container.exec([
    "psql",
    "-U",
    PG_ADMIN_USER,
    "-d",
    PG_DATABASE,
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "/tmp/lwql-migrations.sql",
  ]);
  if (migration.exitCode !== 0) {
    throw new Error(
      `lwql harness: replaying the Prisma migrations failed ` +
        `(psql exit ${migration.exitCode}). psql stops on the first error, so ` +
        `the tail below names the migration statement that failed:\n${migration.stderr}`,
    );
  }

  await applyAsAdmin([
    `ALTER DATABASE ${PG_DATABASE} SET log_statement='all'`,
    ...lwqlApprovedPostgresViewNames().map(
      (view) => `DROP VIEW IF EXISTS ${PG_SCHEMA}."${view}"`,
    ),
    // Each call already appends the generic seed (every other derived view's
    // base model) after its explicit rows — see `postgresTenantSeedStatements`.
    ...[TENANT_A, TENANT_B].flatMap((tenant) =>
      postgresTenantSeedStatements({ tenantId: tenant.tenantId }),
    ),
    ...POSTGRES_LOAD_FIXTURE_STATEMENTS,
    // The shipped generator, not a hand-copy: a catalog column the approved
    // view forgot would be a failure here rather than a silent exposure.
    ...lwqlPostgresApprovedViewStatements({ schema: PG_SCHEMA }),
  ]);
  await applyAsAdmin(
    postgresReaderRoleStatements({
      reader: {
        role: PG_READER_ROLE,
        password: PG_READER_PASSWORD,
        schema: PG_SCHEMA,
        approvedViews: lwqlApprovedPostgresViewNames(),
        ...DEFAULT_POSTGRES_READER_LIMITS,
        connectionLimit: LWQL_TEST_POSTGRES_CONNECTION_LIMIT,
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
            `lwql harness: ${PG_READER_ROLE} backends were still ` +
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
          `lwql harness: reading PostgreSQL statistics failed: ${result.stderr}`,
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
 * Maps every PostgreSQL-resident catalog entry into the LangWatchQL ClickHouse
 * database as an engine table, and policies each exactly like a native table.
 *
 * Stops at the engine tables. The LangWatchQL views over them — the objects a
 * caller actually names, and the ones carrying the tenant pushdown predicate —
 * are `lwqlViewSetupStatements`' job, so a suite that wants the whole
 * chain calls both, in that order. Keeping them apart is what lets the
 * isolation proof read the *unpredicated* engine table directly and compare.
 */
export async function mapPostgresIntoClickHouse({
  harness,
  postgres,
}: {
  harness: LangWatchQLClickHouseHarness;
  postgres: LangWatchQLPostgresHarness;
}): Promise<LangWatchQLTable[]> {
  const lwqlTables = lwqlPostgresViews(LWQL_VIEW_CATALOG).map(
    (view): LangWatchQLTable => ({
      table: view.sourceTable,
      tenantColumn: PG_MAPPED_TENANT_COLUMN,
    }),
  );
  const collection = lwqlTestNamedCollection(harness.names);
  // Only the named collection reads these fields; the access model (grants and
  // row policies) is single-sourced from the shipped catalog and applied by the
  // suite through `harness.applyAccessModel({ views: lwqlPostgresViews(...) })`
  // once the views exist — exactly as production orders it (#8258).
  const pgDefinition = buildLwqlAccessModelDefinition({
    names: harness.names,
    passwordSha256Hex: RESTRICTED_PASSWORD_SHA256_HEX(),
    namedCollection: {
      collection,
      // The docker host as seen from inside the ClickHouse container; see the
      // module comment for why this is not a shared docker network.
      host: "host.docker.internal",
      port: postgres.container.getPort(),
      database: PG_DATABASE,
      user: PG_READER_ROLE,
      password: PG_READER_PASSWORD,
    },
    sourceDatabase: harness.names.database,
  });
  await harness.applyAsAdmin([
    ...renderLwqlNamedCollectionDdl(pgDefinition),
    ...lwqlTables.map(
      (lwqlTable) =>
        `DROP TABLE IF EXISTS ${harness.names.database}.${lwqlTable.table}`,
    ),
    ...lwqlPostgresEngineTableStatements({
      names: harness.names,
      collection,
    }),
  ]);
  return lwqlTables;
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
