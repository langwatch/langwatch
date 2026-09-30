/**
 * Single-source snapshot of the access DDL (issue #8258, AC6).
 *
 * Production `sql` mode renders its access DDL from the one shared definition
 * via {@link renderLwqlAccessModelDdl} / {@link renderLwqlNamedCollectionDdl} —
 * the same definition the chart's `users.d` / `config.d` YAML renders from — so
 * there is a single source of the access model. The per-statement builders were
 * deleted; this snapshots the emitter's output for fixed inputs so any drift in
 * the one remaining code path is caught, and pins the two invariants that
 * matter: the user is identified by sha256 hash (never the plaintext, AC5), and
 * every row policy precedes every grant (fail-closed).
 *
 * @see ../accessModelDdl.ts
 * @see ../accessModelDefinition.ts
 */

import { describe, expect, it } from "vitest";

import type { LangWatchQLNames } from "../accessModel";
import {
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
    /** @scenario "The DDL emitter renders the whole access model from the shared definition" */
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
