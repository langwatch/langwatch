/**
 * LangWatchQL's isolation as other users and the server's own logs see it, against a real
 * ClickHouse carrying the image's query masking (ADR-200).
 * Spec: specs/lwql/isolation.feature
 */
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  CLICKHOUSE_ERROR_CODE,
  expectClickHouseError,
  type LangWatchQLClickHouseHarness,
  LWQL_CLICKHOUSE_TEST_IMAGE,
  lwqlNamesForSuite,
  recordSeedControl,
  selectRows,
  selectScalar,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness.ts";
import {
  lwqlQueryMaskingConfigFile,
  markServerLogs,
  serverLogsHolding,
} from "./lwql-server-logs.fixture.ts";

const SUITE = "isolation";

/** A capability no other run has used, so a log line holding it can only be this run's. */
function freshCapability(): string {
  return randomBytes(32).toString("hex");
}

/** The ClickHouse error code a call was refused with; 0 when it answered. */
async function refusalCodeOf(run: () => Promise<unknown>): Promise<number> {
  try {
    await run();
    return 0;
  } catch (error) {
    return error instanceof Error && "code" in error ? Number(error.code) : -1;
  }
}

/** An operator's server-wide default turning the cache and introspection on, misconfigured. */
const DEFAULT_PROFILE_FILE = "/etc/clickhouse-server/users.d/lwql-test-default-opened.xml";
const DEFAULT_PROFILE_OPENED =
  "<clickhouse><profiles><default><use_query_cache>1</use_query_cache>" +
  "<query_cache_nondeterministic_function_handling>save</query_cache_nondeterministic_function_handling>" +
  "<allow_introspection_functions>1</allow_introspection_functions>" +
  "</default></profiles></clickhouse>";

describe("given LangWatchQL provisioned on a real ClickHouse with two tenants", () => {
  let harness: LangWatchQLClickHouseHarness;
  let tenantA: ClickHouseClient;
  let tenantB: ClickHouseClient;
  let database: string;
  const opened: ClickHouseClient[] = [];

  /** Binds `keyHash` to each tenant in the key map, as the admin target writes it. */
  async function mapKey(keyHash: string, tenantIds: readonly string[]): Promise<void> {
    await harness.admin.insert({
      table: `${harness.factDatabase}.${harness.names.keyMapTable}`,
      values: tenantIds.map((tenantId) => ({ KeyHash: keyHash, TenantId: tenantId })),
      format: "JSONEachRow",
    });
  }

  /** A server user of the test's own, created by the admin and closed with the suite. */
  async function userClient(name: string, grants: readonly string[]): Promise<ClickHouseClient> {
    const password = randomBytes(12).toString("hex");
    await harness.applyAsAdmin([
      `DROP USER IF EXISTS ${name}`,
      `CREATE USER ${name} IDENTIFIED WITH plaintext_password BY '${password}'`,
      ...grants.map((grant) => `GRANT ${grant} TO ${name}`),
    ]);
    const client = createClient({ url: harness.container.getHttpUrl(), username: name, password });
    opened.push(client);
    return client;
  }

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({
      suite: SUITE,
      image: LWQL_CLICKHOUSE_TEST_IMAGE,
      extraConfigFiles: [
        lwqlQueryMaskingConfigFile({ settings: [lwqlNamesForSuite(SUITE).tenantSetting] }),
        // Off in the stock image; on, so its refusal is the grant's and not a missing table.
        {
          name: "session-log.xml",
          target: "/etc/clickhouse-server/config.d/session-log.xml",
          contents:
            "<clickhouse><session_log><database>system</database><table>session_log</table>" +
            "</session_log></clickhouse>\n",
        },
      ],
    });
    database = harness.names.database;
    tenantA = await harness.restrictedClient({ keyHash: harness.tenantA.keyHash });
    tenantB = await harness.restrictedClient({ keyHash: harness.tenantB.keyHash });
  }, 240_000);

  afterAll(async () => {
    await Promise.all(opened.map((client) => client.close()));
    await harness?.stop();
  });

  describe("when the executor runs a query for a tenant", () => {
    /** @scenario "The capability never appears in a request URL or a server log" */
    it("carries the capability in the body, and no log the server keeps holds it", async () => {
      const capability = freshCapability();
      await mapKey(capability, [harness.tenantA.tenantId]);
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const executor = ClickHouseLangWatchQLExecutorRepository.create({
        connection: {
          ...harness.restrictedConnection(),
          database,
          tenantSetting: harness.names.tenantSetting,
        },
      });
      const since = await markServerLogs(harness);

      const result = await executor.execute({
        sql: `SELECT count() AS n FROM ${database}.traces`,
        tenantCapability: capability,
        projectIds: [harness.tenantA.tenantId],
      });
      await executor.close();

      expect(Number(result.rows[0]?.n)).toBe(control.tenantA);
      expect(await serverLogsHolding({ harness, since, value: capability })).toEqual([]);
    });

    it("hides every hash of a two-project capability, joined or apart", async () => {
      const [first, second] = [freshCapability(), freshCapability()];
      await mapKey(first, [harness.tenantA.tenantId]);
      await mapKey(second, [harness.tenantB.tenantId]);
      const capability = `${first},${second}`;
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const executor = ClickHouseLangWatchQLExecutorRepository.create({
        connection: {
          ...harness.restrictedConnection(),
          database,
          tenantSetting: harness.names.tenantSetting,
        },
      });
      const since = await markServerLogs(harness);

      const result = await executor.execute({
        sql: `SELECT count() AS n FROM ${database}.traces`,
        tenantCapability: capability,
        projectIds: [harness.tenantA.tenantId],
      });
      await executor.close();

      expect(Number(result.rows[0]?.n)).toBe(control.tenantA + control.tenantB);
      for (const value of [capability, first, second]) {
        expect(await serverLogsHolding({ harness, since, value })).toEqual([]);
      }
    });

    /** @scenario "The query log names the tenant without the raw key or its hash" */
    it("names the run's projects in log_comment while no column holds the hash or the raw key", async () => {
      const executor = ClickHouseLangWatchQLExecutorRepository.create({
        connection: {
          ...harness.restrictedConnection(),
          database,
          tenantSetting: harness.names.tenantSetting,
        },
      });
      const marker = `lwql-audit-${randomBytes(6).toString("hex")}`;
      const run = (sql: string) =>
        executor.execute({
          sql,
          tenantCapability: harness.tenantA.keyHash,
          projectIds: [harness.tenantA.tenantId],
        });
      await run(`SELECT count() AS n, '${marker}-plain' AS marker FROM ${database}.traces`);
      // A subquery naming another tenant's comment, which the validator would refuse: ours wins.
      await run(
        `SELECT count() AS n, '${marker}-spoof' AS marker FROM (SELECT TenantId FROM ` +
          `${database}.traces SETTINGS log_comment = 'lwql:project=${harness.tenantB.tenantId}')`,
      );
      await executor.close();
      await harness.applyAsAdmin(["SYSTEM FLUSH LOGS"]);

      const entries = await selectRows<Record<string, unknown>>(
        harness.admin,
        `SELECT * FROM system.query_log WHERE type = 'QueryFinish' ` +
          `AND user = '${harness.names.restrictedUser}' AND position(query, '${marker}') > 0`,
      );
      const commentOf = (kind: string) =>
        entries.find((entry) => String(entry.query).includes(`${marker}-${kind}`))?.log_comment;
      expect(entries).toHaveLength(2);
      expect(commentOf("plain")).toBe(`lwql:project=${harness.tenantA.tenantId}`);
      expect(commentOf("spoof")).toBe(`lwql:project=${harness.tenantA.tenantId}`);
      for (const entry of entries) {
        expect((entry.Settings as Record<string, string>)[harness.names.tenantSetting]).toBe(
          undefined,
        );
        const serialised = JSON.stringify(entry);
        expect(serialised).not.toContain(harness.tenantA.keyHash);
        expect(serialised).not.toContain(harness.tenantA.rawSecret);
      }
    });

    it("keeps the capability out of a failed statement's error and every server log", async () => {
      const capability = freshCapability();
      await mapKey(capability, [harness.tenantA.tenantId]);
      const executor = ClickHouseLangWatchQLExecutorRepository.create({
        connection: {
          ...harness.restrictedConnection(),
          database,
          tenantSetting: harness.names.tenantSetting,
        },
      });
      const since = await markServerLogs(harness);
      const failing = [
        // A syntax error at the tail: the server quotes the text from the capability's clause on.
        `SELECT count() AS n FROM ${database}.traces WHERE`,
        `SELECT no_such_column FROM ${database}.traces`,
      ];

      const thrown: unknown[] = [];
      for (const sql of failing) {
        thrown.push(
          await executor
            .execute({ sql, tenantCapability: capability, projectIds: [harness.tenantA.tenantId] })
            .then(
              () => null,
              (error: unknown) => error,
            ),
        );
      }
      await executor.close();

      expect(thrown.every((error) => error !== null)).toBe(true);
      expect(inspect(thrown, { depth: 8 })).not.toContain(capability);
      expect(await serverLogsHolding({ harness, since, value: capability })).toEqual([]);
    });

    it("finds a setting the masking does not name in every log, so the search can fail", async () => {
      // Not 64 hex characters, so the image's sha256 rule leaves it in place.
      const marker = `leak-control-${randomBytes(16).toString("hex")}`;
      const since = await markServerLogs(harness);

      await selectRows(
        harness.admin,
        `SELECT 1 AS value SETTINGS custom_leak_control = '${marker}'`,
      );

      expect(await serverLogsHolding({ harness, since, value: marker })).toEqual([
        "query_log.Settings",
        "query_log.query",
        "server log file",
        "text_log",
      ]);
    });
  });

  describe("when the restricted user queries the system tables that record other users' work", () => {
    /** @scenario "The restricted user never reads another tenant's rows through any system table" */
    it("refuses each of them", async () => {
      const tables = [
        "system.processes",
        "system.user_processes",
        "system.text_log",
        "system.query_thread_log",
        "system.query_views_log",
        "system.part_log",
        "system.session_log",
        "system.opentelemetry_span_log",
        "system.asynchronous_insert_log",
      ];
      for (const table of tables) {
        await expectClickHouseError(
          () => selectRows(tenantA, `SELECT count() FROM ${table}`),
          CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
          table,
        );
      }
    });
  });

  describe("when both tenants run the same filtered query", () => {
    /** @scenario "The query condition cache never carries one tenant's result into another's" */
    it("keeps the condition cache off for the restricted user, and each tenant its own count", async () => {
      const model = `cache-probe-${freshCapability().slice(0, 12)}`;
      // One insert, one part: both tenants share the granule a cache would remember.
      await harness.admin.insert({
        table: `${database}.traces`,
        values: [
          { TenantId: harness.tenantA.tenantId, TraceId: `${model}-a`, Model: "other", Latency: 1 },
          { TenantId: harness.tenantB.tenantId, TraceId: `${model}-b1`, Model: model, Latency: 1 },
          { TenantId: harness.tenantB.tenantId, TraceId: `${model}-b2`, Model: model, Latency: 1 },
        ],
        format: "JSONEachRow",
      });
      const cache = await selectScalar<unknown>(
        tenantA,
        "SELECT getSetting('use_query_condition_cache') AS value",
      );
      const statement = `SELECT count() AS value FROM ${database}.traces WHERE Model = '${model}'`;

      const first = await selectScalar<string>(tenantA, statement);
      const second = await selectScalar<string>(tenantB, statement);
      const third = await selectScalar<string>(tenantA, statement);

      expect(String(cache)).toMatch(/^(0|false)$/);
      expect({ first: Number(first), second: Number(second), third: Number(third) }).toEqual({
        first: 0,
        second: 2,
        third: 0,
      });
    });
  });

  describe("when the restricted user reaches for anything it was not granted", () => {
    /** @scenario "The restricted user gets only what it is granted: no cache, no dictionary, no table function, and a revoked key reads nothing at once" */
    it("refuses turning either cache on, readonly first (164), before the CONST pin", async () => {
      for (const setting of ["use_query_cache", "use_query_condition_cache"]) {
        const code = await refusalCodeOf(() =>
          selectRows(tenantA, `SELECT 1 AS value SETTINGS ${setting} = 1`),
        );
        expect(code, `${setting} = 1`).toBe(CLICKHOUSE_ERROR_CODE.READONLY);
      }
    });

    /** @scenario "The restricted user gets only what it is granted: no cache, no dictionary, no table function, and a revoked key reads nothing at once" */
    it("caches nothing and allows no introspection when the default profile turns both on", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const marker = `result-cache-${freshCapability().slice(0, 12)}`;
      const statement = `SELECT count() AS value FROM ${database}.traces WHERE TraceId != '${marker}'`;
      await harness.container.exec([
        "sh",
        "-c",
        `printf '%s' '${DEFAULT_PROFILE_OPENED}' > ${DEFAULT_PROFILE_FILE}`,
      ]);
      await harness.applyAsAdmin(["SYSTEM RELOAD CONFIG", "SYSTEM RELOAD USERS"]);
      try {
        const plain = await userClient(`${harness.names.restrictedUser}_plain`, []);
        const pinned = ["use_query_cache", "allow_introspection_functions"];
        for (const setting of pinned) {
          const opened = await selectScalar<unknown>(
            plain,
            `SELECT getSetting('${setting}') AS value`,
          );
          const forLwql = await selectScalar<unknown>(
            tenantA,
            `SELECT getSetting('${setting}') AS value`,
          );
          expect(String(opened), `the default profile must turn ${setting} on`).toMatch(
            /^(1|true)$/,
          );
          expect(String(forLwql), `${setting} for the restricted user`).toMatch(/^(0|false)$/);
        }

        const counts = {
          a1: Number(await selectScalar<string>(tenantA, statement)),
          b: Number(await selectScalar<string>(tenantB, statement)),
          a2: Number(await selectScalar<string>(tenantA, statement)),
        };
        const entries = await selectScalar<string>(
          harness.admin,
          `SELECT count() AS value FROM system.query_cache WHERE query LIKE '%${marker}%' ` +
            "SETTINGS use_query_cache = 0",
        );

        expect(counts).toEqual({ a1: control.tenantA, b: control.tenantB, a2: control.tenantA });
        expect(Number(entries)).toBe(0);
      } finally {
        await harness.container.exec(["rm", "-f", DEFAULT_PROFILE_FILE]);
        await harness.applyAsAdmin(["SYSTEM RELOAD CONFIG", "SYSTEM RELOAD USERS"]);
      }
    });

    /** @scenario "The restricted user gets only what it is granted: no cache, no dictionary, no table function, and a revoked key reads nothing at once" */
    it("holds exactly its grants, and refuses a dictionary, table functions and introspection", async () => {
      const user = harness.names.restrictedUser;
      const grants = await selectRows<Record<string, string>>(
        harness.admin,
        `SHOW GRANTS FOR ${user}`,
      );
      expect(grants.map((row) => String(Object.values(row)[0])).toSorted()).toEqual(
        [
          `GRANT SELECT ON ${harness.factDatabase}.${harness.names.keyMapTable} TO ${user}`,
          `GRANT SELECT ON ${database}.spans TO ${user}`,
          `GRANT SELECT ON ${database}.traces TO ${user}`,
        ].toSorted(),
      );
      await harness.applyAsAdmin([
        // A dictionary over the key map would answer past every row policy, so it must stay shut.
        `CREATE OR REPLACE DICTIONARY ${database}.lwql_probe_dictionary ` +
          "(KeyHash String, TenantId String) PRIMARY KEY KeyHash " +
          `SOURCE(CLICKHOUSE(DB '${harness.factDatabase}' TABLE '${harness.names.keyMapTable}' ` +
          `USER '${ADMIN_USER}' PASSWORD '${ADMIN_PASSWORD}')) ` +
          "LAYOUT(COMPLEX_KEY_HASHED()) LIFETIME(0)",
      ]);
      const attempts = {
        dictGet:
          `SELECT dictGet('${database}.lwql_probe_dictionary', 'TenantId', ` +
          `tuple('${harness.tenantB.keyHash}')) AS value`,
        remote: "SELECT * FROM remote('127.0.0.1', system.one)",
        url: "SELECT * FROM url('http://127.0.0.1:1/x.csv', CSV, 'a String')",
        file: "SELECT * FROM file('lwql-probe.csv', CSV, 'a String')",
        s3: "SELECT * FROM s3('http://127.0.0.1:1/bucket/x.csv', CSV, 'a String')",
        introspection: "SELECT addressToSymbol(toUInt64(1)) AS value",
      };
      const codes = Object.fromEntries(
        await Promise.all(
          Object.entries(attempts).map(
            async ([name, sql]) =>
              [name, await refusalCodeOf(() => selectRows(tenantA, sql))] as const,
          ),
        ),
      );
      // Every probe is a missing grant (497). Introspection with the capability as a request
      // setting met the profile's pin first (446); in the statement's own clause, 26.8 checks the
      // grant first. The pin itself is proven through getSetting in the default-profile case.
      expect(codes).toEqual({
        dictGet: CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        remote: CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        url: CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        file: CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        s3: CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        introspection: CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
      });
    });

    /** @scenario "The restricted user gets only what it is granted: no cache, no dictionary, no table function, and a revoked key reads nothing at once" */
    it("reads nothing with a key the very next query after its key-map row is deleted", async () => {
      const capability = freshCapability();
      await mapKey(capability, [harness.tenantA.tenantId]);
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const holder = await harness.restrictedClient({ keyHash: capability });
      const countOf = async () =>
        Number(
          await selectScalar<string>(holder, `SELECT count() AS value FROM ${database}.traces`),
        );
      const before = await countOf();

      await harness.applyAsAdmin([
        `DELETE FROM ${harness.factDatabase}.${harness.names.keyMapTable} WHERE KeyHash = '${capability}'`,
      ]);

      expect(before).toBe(control.tenantA);
      expect(await countOf()).toBe(0);
    });
  });

  describe("when a user may use the PostgreSQL collection but not read its secrets", () => {
    /** @scenario "The named collection's keys cannot be redirected" */
    it("refuses a PostgreSQL table and postgresql() that name another host", async () => {
      const collection = `${harness.names.restrictedUser}_pg`;
      await harness.applyAsAdmin([
        `DROP NAMED COLLECTION IF EXISTS ${collection}`,
        `CREATE NAMED COLLECTION ${collection} AS host = 'postgres.invalid', port = 5432, ` +
          "user = 'lwql_reader', password = 'never-sent-elsewhere', database = 'langwatch', " +
          "table = 'Project'",
      ]);
      const user = await userClient(`${harness.names.restrictedUser}_collection_user`, [
        `NAMED COLLECTION ON ${collection}`,
        `CREATE TABLE ON ${database}.*`,
        "POSTGRES ON *.*",
      ]);

      await expectClickHouseError(
        () =>
          selectRows(user, `SELECT * FROM postgresql(${collection}, host = 'redirect.invalid')`),
        CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        "postgresql() with another host",
      );
      await expectClickHouseError(
        () =>
          user.command({
            query:
              `CREATE TABLE ${database}.redirected (id Int32) ` +
              `ENGINE = PostgreSQL(${collection}, host = 'redirect.invalid')`,
          }),
        CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        "a PostgreSQL table with another host",
      );
      // The grants themselves suffice: unredirected, the call gets as far as dialling.
      const unredirected = await selectRows(user, `SELECT * FROM postgresql(${collection})`).then(
        () => "answered",
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      expect(unredirected).not.toMatch(/ACCESS_DENIED|Not enough privileges/);
    });
  });

  describe("when one key-map hash is bound to two tenants", () => {
    /** @scenario "One hash mapped to two tenants reads nothing" */
    it("reads zero rows with it, while a hash bound to one tenant reads that tenant's", async () => {
      const conflicting = freshCapability();
      const single = freshCapability();
      await mapKey(conflicting, [harness.tenantA.tenantId, harness.tenantB.tenantId]);
      await mapKey(single, [harness.tenantA.tenantId]);
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const both = await harness.restrictedClient({ keyHash: conflicting });
      const one = await harness.restrictedClient({ keyHash: single });
      const countOf = (client: ClickHouseClient) =>
        selectScalar<string>(client, `SELECT count() AS value FROM ${database}.traces`);

      expect(Number(await countOf(both))).toBe(0);
      expect(Number(await countOf(one))).toBe(control.tenantA);
    });
  });
});
