/** The SQL emitter's output for a fixed definition, pinned as a snapshot (ADR-159). */
import { describe, expect, it } from "vitest";

import { LangWatchQLAccessModelDefinitionService } from "../langwatch-ql-access-model-definition.service.ts";
import type { LangWatchQLNames } from "../langwatch-ql-access-model.service.ts";
import type { PostgresNamedCollection } from "../langwatch-ql-postgres-mapping.service.ts";

const accessModelDefinition = LangWatchQLAccessModelDefinitionService.create();

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

const definition = accessModelDefinition.build({
  names: NAMES,
  passwordSha256Hex: HEX,
  namedCollection: NAMED_COLLECTION,
  sourceDatabase: NAMES.database,
});

// The whole access model, as the sql-mode converge composes it: the users.d
// half (profile, user, policies, grants) plus the config.d half (the named
// collection). One definition, so this is the single shipped source.
const ddl = [
  ...accessModelDefinition.renderDdl(definition),
  ...accessModelDefinition.renderNamedCollectionDdl(definition),
];

describe("the definition-driven access DDL", () => {
  describe("given fixed names, password hash and named collection", () => {
    /** @scenario "The DDL emitter renders the whole access model from the shared definition" */
    it("renders the whole shipped access model, snapshotted", () => {
      expect(ddl).toMatchSnapshot();
    });

    it("identifies the restricted user by sha256 hash, never the plaintext (AC5)", () => {
      const userStatement = ddl.find((statement) => statement.startsWith("CREATE USER OR REPLACE"));
      expect(userStatement).toBe(
        `CREATE USER OR REPLACE ${NAMES.restrictedUser} ` +
          `IDENTIFIED WITH sha256_hash BY '${HEX}' ` +
          `SETTINGS PROFILE ${NAMES.settingsProfile}`,
      );
      expect(userStatement).not.toContain("sha256_password");
    });

    it("orders every row policy before every grant (fail-closed)", () => {
      const lastPolicy = ddl.reduce(
        (last, statement, index) => (statement.startsWith("CREATE ROW POLICY") ? index : last),
        -1,
      );
      const firstGrant = ddl.findIndex((statement) => statement.startsWith("GRANT SELECT"));
      expect(lastPolicy).toBeGreaterThanOrEqual(0);
      expect(firstGrant).toBeGreaterThan(lastPolicy);
    });
  });
});
