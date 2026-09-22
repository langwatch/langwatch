/**
 * The application owns the LangWatchQL access model on every distribution
 * (issue #8258), but where the ClickHouse server itself defines an LWQL entity
 * in its read-only config store (users.xml / config.xml), provisioning must
 * yield to that entity — log it, skip its statements, and still provision
 * everything else — rather than crash the boot.
 *
 * This exercises the shipped provisioning statements (composed from the same
 * builders `selfHostedClickHouseProvisioningStatements` uses, over the shipped
 * migrations and a live PostgreSQL) against a real ClickHouse whose `users.d`
 * defines the `langwatch_lwql` user and `lwql_restricted` profile and whose
 * `config.d` defines the `lwql_postgres` named collection, through the same
 * config-store-tolerant runner `provisionLwql` uses. No mocks: the container
 * really rejects the config-owned statements with codes 495/669/670/671, and
 * the assertions read the server's own state back.
 *
 * @see ../clickhouseStatementRunner.ts
 * @see specs/lwql/api.feature
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLICKHOUSE_ERROR_CODE,
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  mapPostgresIntoClickHouse,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "../../__tests__/lwqlClickHouseHarness";
import { LWQL_VIEW_CATALOG } from "../../catalog/lwqlViews";
import {
  type LangWatchQLNames,
  lwqlClickHouseSetupStatements,
} from "../accessModel";
import {
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "../catalogStatements";
import {
  inventoryConfigStoreLwqlEntities,
  runClickHouseStatements,
} from "../clickhouseStatementRunner";
import { postgresNamedCollectionStatements } from "../postgresMapping";

// The names the app self-provisions on every distribution; these are the ones a
// config store would define, so the test targets them deliberately.
const CONFIG_STORE_USER = "langwatch_lwql";
const CONFIG_STORE_PROFILE = "lwql_restricted";
const CONFIG_STORE_COLLECTION = "lwql_postgres";
const RESTRICTED_PASSWORD = "restricted-provision-secret";
const READER_PASSWORD = "reader-provision-secret";

/** A `users.d` file defining the LWQL identity and profile in the config store. */
const USERS_XML = `<clickhouse>
    <profiles>
        <${CONFIG_STORE_PROFILE}>
            <readonly>1</readonly>
        </${CONFIG_STORE_PROFILE}>
    </profiles>
    <users>
        <${CONFIG_STORE_USER}>
            <password>xml-owned-password</password>
            <profile>${CONFIG_STORE_PROFILE}</profile>
            <networks><ip>::/0</ip></networks>
            <quota>default</quota>
        </${CONFIG_STORE_USER}>
    </users>
</clickhouse>
`;

/** A `config.d` file defining the LWQL named collection in the config store. */
const NAMED_COLLECTION_XML = `<clickhouse>
    <named_collections>
        <${CONFIG_STORE_COLLECTION}>
            <host>host.docker.internal</host>
            <port>5432</port>
            <database>lwqltest</database>
            <user>lwql_ro</user>
            <password>xml-owned-reader-password</password>
        </${CONFIG_STORE_COLLECTION}>
    </named_collections>
</clickhouse>
`;

describe("given a ClickHouse whose config store already owns LangWatchQL entities", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let names: LangWatchQLNames;

  beforeAll(async () => {
    // The catalog's PostgreSQL-resident views cannot be created until their
    // engine tables exist, and those read a live PostgreSQL. Stood up first for
    // that reason, exactly as `catalogStatements.integration.test.ts` does — not
    // because this suite is about PostgreSQL.
    postgres = await startLangWatchQLPostgres();
    harness = await startLangWatchQLClickHouse({
      suite: "config-store-skip",
      // The shipped migrations, so every fact table the catalog reads exists;
      // the fixture set is a subset and the views would not resolve over it.
      facts: "migrated",
      extraConfigFiles: [
        {
          name: "lwql-config-store-user.xml",
          target:
            "/etc/clickhouse-server/users.d/zzz-lwql-config-store-user.xml",
          contents: USERS_XML,
        },
        {
          name: "lwql-config-store-collection.xml",
          target: "/etc/clickhouse-server/config.d/lwql-config-store.xml",
          contents: NAMED_COLLECTION_XML,
        },
      ],
    });
    // Maps the approved PostgreSQL views in as engine tables under the
    // LangWatchQL database, so the catalog views the provisioning creates below
    // have their PostgreSQL-resident sources to read.
    await mapPostgresIntoClickHouse({ harness, postgres });
    // Provision under the exact names the config store owns, so the identity,
    // profile and collection statements land on read-only entities.
    names = {
      ...harness.names,
      restrictedUser: CONFIG_STORE_USER,
      settingsProfile: CONFIG_STORE_PROFILE,
    };
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
    await postgres?.stop();
  });

  describe("when the shipped provisioning runs against it", () => {
    // # Issue #8258
    /** @scenario "A config-defined LangWatchQL entity is skipped, not fatal" */
    it("skips the config-owned entities, provisions the rest, and never throws", async () => {
      // The operator inventory names, at warn, what will be skipped.
      const preflight = await inventoryConfigStoreLwqlEntities({
        client: harness.admin,
        names,
      });
      expect(preflight).toEqual(
        expect.arrayContaining([
          { kind: "user", name: CONFIG_STORE_USER },
          { kind: "settings_profile", name: CONFIG_STORE_PROFILE },
        ]),
      );

      // The shipped provisioning statements, composed from the same builders
      // `selfHostedClickHouseProvisioningStatements` uses. Composed directly
      // rather than through that wrapper because its single-database guard is a
      // production invariant the test harness deliberately breaks: the shipped
      // migrations land the fact tables in their own database, so — as in
      // `catalogStatements.integration.test.ts` — the views read facts from
      // `harness.factDatabase` while the identity, collection and views
      // themselves live in `names.database`. The identity and named collection
      // statements target the config-store-owned names, so the runner must skip
      // them; every other statement (views, grants to the config-store user)
      // still runs or is tolerated by code.
      const statements = [
        ...lwqlClickHouseSetupStatements({
          names,
          password: RESTRICTED_PASSWORD,
          lwqlTables: [],
          sourceDatabase: harness.factDatabase,
          // Kept out so the proof is about config-store tolerance, not the
          // replica-store probe.
          includeAppFunctions: false,
        }),
        ...postgresNamedCollectionStatements({
          connection: {
            collection: CONFIG_STORE_COLLECTION,
            host: "host.docker.internal",
            port: 5432,
            database: "lwqltest",
            user: "lwql_ro",
            password: READER_PASSWORD,
          },
        }),
        ...lwqlViewSetupStatements({
          names,
          sourceDatabase: harness.factDatabase,
          dedup: SHIPPED_LWQL_DEDUP,
        }),
      ];

      // The whole point: no throw, even though several statements target
      // read-only config-store entities.
      const { skipped } = await runClickHouseStatements({
        client: harness.admin,
        statements,
        secrets: [RESTRICTED_PASSWORD, READER_PASSWORD],
        // The real inventory: a 495 is tolerated only against a statement that
        // names the config-store user or profile it found. Every 495-failing
        // statement here (the CREATE USER, its grants and row policies) names
        // langwatch_lwql or lwql_restricted, so all are tolerated.
        configStoreEntities: preflight,
      });

      // Both kinds of config-store rejection were tolerated and named.
      expect(
        skipped.some(
          (s) =>
            s.statement.startsWith("CREATE USER OR REPLACE") &&
            s.code === CLICKHOUSE_ERROR_CODE.ACCESS_STORAGE_READONLY,
        ),
        "the config-owned user CREATE was skipped as 495",
      ).toBe(true);
      // The named-collection code the server raises varies by path/version
      // (669 doesn't-exist, 670 already-exists, 671 immutable); accept any.
      const namedCollectionCodes = [
        CLICKHOUSE_ERROR_CODE.NAMED_COLLECTION_DOESNT_EXIST,
        CLICKHOUSE_ERROR_CODE.NAMED_COLLECTION_ALREADY_EXISTS,
        CLICKHOUSE_ERROR_CODE.NAMED_COLLECTION_IS_IMMUTABLE,
      ] as number[];
      expect(
        skipped.some(
          (s) =>
            s.statement.startsWith("DROP NAMED COLLECTION") &&
            namedCollectionCodes.includes(s.code),
        ),
        "the config-owned named collection DROP was skipped as 669/670/671",
      ).toBe(true);
      expect(
        skipped.some(
          (s) =>
            s.statement.startsWith("CREATE NAMED COLLECTION") &&
            namedCollectionCodes.includes(s.code),
        ),
        "the config-owned named collection CREATE was skipped as 669/670/671",
      ).toBe(true);
      // Every skip is one of the four tolerated codes, never a laundered failure.
      for (const skip of skipped) {
        expect([
          CLICKHOUSE_ERROR_CODE.ACCESS_STORAGE_READONLY,
          CLICKHOUSE_ERROR_CODE.NAMED_COLLECTION_DOESNT_EXIST,
          CLICKHOUSE_ERROR_CODE.NAMED_COLLECTION_ALREADY_EXISTS,
          CLICKHOUSE_ERROR_CODE.NAMED_COLLECTION_IS_IMMUTABLE,
        ]).toContain(skip.code);
        expect(skip.statement).not.toContain(RESTRICTED_PASSWORD);
      }

      // Provisioning continued: the LangWatchQL views exist despite the skips.
      const viewRows = (await (
        await harness.admin.query({
          query: `SELECT name FROM system.tables WHERE database = '${harness.names.database}' AND engine = 'View'`,
          format: "JSONEachRow",
        })
      ).json()) as Array<{ name: string }>;
      const viewNames = new Set(viewRows.map((row) => row.name));
      for (const view of LWQL_VIEW_CATALOG) {
        expect(
          viewNames.has(view.name),
          `view ${view.name} was provisioned`,
        ).toBe(true);
      }

      // The config-store identity is still the one that exists, untouched.
      const userRows = (await (
        await harness.admin.query({
          query: `SELECT storage FROM system.users WHERE name = '${CONFIG_STORE_USER}'`,
          format: "JSONEachRow",
        })
      ).json()) as Array<{ storage: string }>;
      // The config-store identity is the only one — the app never created an
      // SQL-storage twin, because its CREATE USER was skipped.
      expect(userRows).toEqual([{ storage: "users_xml" }]);
    });
  });
});
