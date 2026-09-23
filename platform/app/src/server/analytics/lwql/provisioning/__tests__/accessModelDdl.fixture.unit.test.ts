/**
 * Single-source byte-identity guard (issue #8258, AC6).
 *
 * Production `sql` mode now renders its access DDL from the one shared
 * definition via {@link renderLwqlAccessModelDdl} / {@link renderLwqlNamedCollectionDdl}
 * — the same definition the chart's `users.d` / `config.d` YAML renders from —
 * so there is a single source of the access model. This snapshots that output
 * for fixed inputs and asserts, statement by statement, that it is byte-identical
 * to the shipped reference builders, with one deliberate exception: the
 * restricted-user statement now carries `IDENTIFIED WITH sha256_hash BY '<hex>'`
 * instead of `sha256_password BY '<plaintext>'`. The stored digest is identical,
 * so an existing sql-store user reconverges without any password change; the
 * definition never holds the plaintext (AC5).
 *
 * @see ../accessModelDdl.ts
 * @see ../accessModelDefinition.ts
 * @scenario "The DDL emitter output is byte-identical to the shipped access statements"
 */

import { describe, expect, it } from "vitest";

import type { LangWatchQLNames } from "../accessModel";
import {
  lwqlGrantStatement,
  lwqlKeyMapRowPolicyStatement,
  lwqlSettingsProfileStatement,
  renderLwqlAccessModelDdl,
  renderLwqlNamedCollectionDdl,
} from "../accessModelDdl";
import { buildLwqlAccessModelDefinition } from "../accessModelDefinition";
import type { PostgresNamedCollection } from "../postgresMapping";

const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "langwatch_profile",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

const NAMED_COLLECTION: PostgresNamedCollection = {
  collection: "lwql_postgres",
  host: "pg.internal",
  port: 5432,
  database: "langwatch",
  user: "lwql_ro",
  password: "reader-secret",
};

const HEX = "a".repeat(64);

const definition = buildLwqlAccessModelDefinition({
  names: NAMES,
  passwordSha256Hex: HEX,
  namedCollection: NAMED_COLLECTION,
  sourceDatabase: NAMES.database,
});

// The whole access model, as the sql-mode converge composes it: the users.d
// half (profile, user, policies, grants) plus the config.d half (the named
// collection). One definition, so this is the single shipped source.
const ddl = [
  ...renderLwqlAccessModelDdl(definition),
  ...renderLwqlNamedCollectionDdl(definition),
];

describe("the definition-driven access DDL", () => {
  describe("given fixed names, password hash and named collection", () => {
    it("renders the whole shipped access model, snapshotted", () => {
      expect(ddl).toMatchSnapshot();
    });

    it("identifies the restricted user by sha256 hash, never the plaintext (AC5)", () => {
      const userStatement = ddl.find((statement) =>
        statement.startsWith("CREATE USER OR REPLACE"),
      );
      expect(userStatement).toBe(
        `CREATE USER OR REPLACE ${NAMES.restrictedUser} ` +
          `IDENTIFIED WITH sha256_hash BY '${HEX}' ` +
          `SETTINGS PROFILE ${NAMES.settingsProfile}`,
      );
      expect(userStatement).not.toContain("sha256_password");
    });

    // Every statement the reference builders also produce must remain byte-for-
    // byte identical — the single-source refactor changed only the user line.
    it("keeps the settings profile byte-identical to the reference builder", () => {
      expect(ddl).toContain(lwqlSettingsProfileStatement({ names: NAMES }));
    });

    it("keeps the key-map row policy byte-identical to the reference builder", () => {
      expect(ddl).toContain(
        lwqlKeyMapRowPolicyStatement({
          names: NAMES,
          sourceDatabase: NAMES.database,
        }),
      );
    });

    it("keeps the key-map grant byte-identical to the reference builder", () => {
      expect(ddl).toContain(
        lwqlGrantStatement({
          names: NAMES,
          table: NAMES.keyMapTable,
          database: NAMES.database,
        }),
      );
    });

    it("orders every row policy before every grant (fail-closed)", () => {
      const lastPolicy = ddl.reduce(
        (last, statement, index) =>
          statement.startsWith("CREATE ROW POLICY") ? index : last,
        -1,
      );
      const firstGrant = ddl.findIndex((statement) =>
        statement.startsWith("GRANT SELECT"),
      );
      expect(lastPolicy).toBeGreaterThanOrEqual(0);
      expect(firstGrant).toBeGreaterThan(lastPolicy);
    });
  });
});
