/**
 * The PostgreSQL reader role, as SQL text.
 *
 * The integration suites prove a *well-formed* role is accepted by PostgreSQL
 * and reads only the approved views. What they cannot show is what happens to a
 * malformed one: `CONNECTION LIMIT -1` is valid SQL that PostgreSQL reads as
 * *unlimited*, so a role provisioned with it is created successfully, passes
 * every isolation assertion, and silently carries no connection budget at all.
 * The bound this module exists to hold would be gone with nothing red.
 *
 * This file is that refusal check — it fails when a value PostgreSQL would
 * quietly reinterpret stops being rejected before it reaches the server.
 *
 * @see ../postgresMapping.ts — the statements under test
 * @see specs/lwql/api.feature
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_POSTGRES_READER_LIMITS,
  organizationTenantPath,
  type PostgresReaderRole,
  parentTenantPath,
  postgresApprovedViewStatement,
  postgresReaderRoleStatements,
  projectTenantPath,
  teamTenantPath,
} from "../postgresMapping";

/** A role that is valid in every respect, so a case varies exactly one thing. */
function readerRole(
  overrides: Partial<PostgresReaderRole> = {},
): PostgresReaderRole {
  return {
    role: "ChReader",
    password: "not-a-real-password",
    schema: "public",
    approvedViews: ["lwql_traces"],
    connectionLimit: DEFAULT_POSTGRES_READER_LIMITS.connectionLimit,
    statementTimeout: DEFAULT_POSTGRES_READER_LIMITS.statementTimeout,
    ...overrides,
  };
}

describe("given the PostgreSQL reader role statements", () => {
  describe("when the connection limit is a positive integer", () => {
    it("carries the limit into the ALTER ROLE statement", () => {
      const statements = postgresReaderRoleStatements({
        reader: readerRole({ connectionLimit: 7 }),
      });

      expect(
        statements.some((statement) =>
          statement.includes("CONNECTION LIMIT 7"),
        ),
      ).toBe(true);
    });
  });

  // These statements are meant to converge the role: what they emit is the
  // whole of what it may read, not an addition to whatever it read before.
  // Convergence is the part a test has to hold, because the failure is silent
  // — the role keeps a grant nobody asked it to keep, and every statement here
  // still looks correct in isolation.
  describe("when a relation is no longer approved", () => {
    it("revokes relation privileges, not only schema privileges", () => {
      const statements = postgresReaderRoleStatements({
        reader: readerRole({ approvedViews: ["lwql_traces"] }),
      });

      // REVOKE ALL ON SCHEMA covers CREATE and USAGE on the schema itself.
      // Table and view privileges live on the relations and outlive it, so a
      // view dropped from approvedViews stays readable without this.
      expect(
        statements,
        "schema-level revoke does not reach relation grants",
      ).toContain(
        `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM "ChReader"`,
      );
    });

    it("revokes before it grants, so the revoke cannot undo the new grants", () => {
      const statements = postgresReaderRoleStatements({
        reader: readerRole({ approvedViews: ["lwql_traces"] }),
      });
      const revokeAt = statements.findIndex((statement) =>
        statement.includes("REVOKE ALL PRIVILEGES ON ALL TABLES"),
      );
      const grantAt = statements.findIndex((statement) =>
        statement.includes(`GRANT SELECT ON "public"."lwql_traces"`),
      );

      expect(revokeAt).toBeGreaterThan(-1);
      expect(grantAt).toBeGreaterThan(-1);
      // Ordering is the whole point: run the other way round and the role ends
      // the run able to read nothing at all.
      expect(revokeAt).toBeLessThan(grantAt);
    });
  });

  // -1 is the case the guard exists for: PostgreSQL accepts it and reads it as
  // unlimited, so it is the one malformed value that would otherwise provision
  // cleanly and leave the budget uncapped.
  describe.each([
    { label: "unlimited (-1)", connectionLimit: -1 },
    { label: "zero", connectionLimit: 0 },
    { label: "negative", connectionLimit: -5 },
    { label: "fractional", connectionLimit: 2.5 },
    { label: "not a number", connectionLimit: Number.NaN },
  ])("when the connection limit is $label", ({ connectionLimit }) => {
    it("refuses to emit any statement", () => {
      expect(() =>
        postgresReaderRoleStatements({
          reader: readerRole({ connectionLimit }),
        }),
      ).toThrow(/connectionLimit must be a positive integer/);
    });
  });

  describe("when no view is approved", () => {
    it("refuses to provision a role that could read nothing", () => {
      expect(() =>
        postgresReaderRoleStatements({
          reader: readerRole({ approvedViews: [] }),
        }),
      ).toThrow(/at least one approved view/);
    });
  });

  // The password is the one caller-supplied value that reaches the SQL as a
  // literal rather than a quoted identifier. A random-generated chart password
  // can contain a single quote; without doubling it, the quote closes the
  // literal early and the ALTER ROLE either errors or, worse, parses into a
  // different statement.
  describe("when the password contains a single quote", () => {
    it("doubles the quote so the literal stays closed", () => {
      const statements = postgresReaderRoleStatements({
        reader: readerRole({ password: "pa'ss'word" }),
      });
      const alter = statements.find((statement) =>
        statement.includes("WITH LOGIN PASSWORD"),
      );

      expect(alter).toContain("PASSWORD 'pa''ss''word'");
      expect(alter).not.toContain("PASSWORD 'pa'ss'word'");
    });
  });

  // Re-provisioning an already-provisioned server must be a no-op on the role's
  // existence: the create is guarded by a pg_roles probe, and every property is
  // converged with ALTER. The probe compares against the unquoted spelling on
  // purpose (see postgresReaderRoleStatements).
  describe("when the role may already exist", () => {
    it("guards CREATE ROLE behind a pg_roles existence probe", () => {
      const statements = postgresReaderRoleStatements({
        reader: readerRole({ role: "lwql_ro" }),
      });
      const create = statements[0];

      expect(create).toContain(
        "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro')",
      );
      expect(create).toContain('CREATE ROLE "lwql_ro" LOGIN');
      // Password and limits are converged unconditionally, so an existing role
      // still lands on the intended state.
      expect(
        statements.some((statement) =>
          statement.includes('ALTER ROLE "lwql_ro" WITH LOGIN PASSWORD'),
        ),
      ).toBe(true);
    });
  });
});

describe("given postgresApprovedViewStatement", () => {
  const SCHEMA = "public";

  describe("when the mapping carries no tenant path", () => {
    it("reads the tenant column off the base relation, aliased m", () => {
      const statement = postgresApprovedViewStatement({
        schema: SCHEMA,
        view: "lwql_topics",
        baseRelation: "Topic",
        columns: [
          { exposed: "TenantId", source: "projectId" },
          { exposed: "TopicId", source: "id" },
        ],
        joins: projectTenantPath(),
      });

      expect(statement).toContain(
        `CREATE OR REPLACE VIEW "public"."lwql_topics" AS\n` +
          `SELECT\n` +
          `  "m"."projectId" AS "TenantId",\n` +
          `  "m"."id" AS "TopicId"\n` +
          `FROM "public"."Topic" AS "m"`,
      );
      expect(statement).toContain(`DROP VIEW IF EXISTS "public"."lwql_topics"`);
      expect(statement).toContain(
        `CREATE VIEW "public"."lwql_topics" AS\n` +
          `SELECT\n` +
          `  "m"."projectId" AS "TenantId",\n` +
          `  "m"."id" AS "TopicId"\n` +
          `FROM "public"."Topic" AS "m"`,
      );
    });
  });

  describe("when the base relation is team-scoped", () => {
    it("joins the base's teamId to Project and reads TenantId off p", () => {
      const statement = postgresApprovedViewStatement({
        schema: SCHEMA,
        view: "lwql_group_things",
        baseRelation: "GroupThing",
        columns: [
          { exposed: "TenantId", source: "id", alias: "p" },
          { exposed: "GroupThingId", source: "id" },
        ],
        joins: teamTenantPath(),
      });

      const expectedBody =
        `SELECT\n` +
        `  "p"."id" AS "TenantId",\n` +
        `  "m"."id" AS "GroupThingId"\n` +
        `FROM "public"."GroupThing" AS "m"\n` +
        `JOIN "public"."Project" AS "p" ON "m"."teamId" = "p"."teamId"`;
      expect(statement).toContain(
        `CREATE OR REPLACE VIEW "public"."lwql_group_things" AS\n${expectedBody}`,
      );
      expect(statement).toContain(
        `DROP VIEW IF EXISTS "public"."lwql_group_things"`,
      );
      expect(statement).toContain(
        `CREATE VIEW "public"."lwql_group_things" AS\n${expectedBody}`,
      );
    });
  });

  describe("when the base relation is organization-scoped", () => {
    it("chains Organization -> Team -> Project and reads TenantId off p", () => {
      const statement = postgresApprovedViewStatement({
        schema: SCHEMA,
        view: "lwql_virtual_keys",
        baseRelation: "VirtualKey",
        columns: [
          { exposed: "TenantId", source: "id", alias: "p" },
          { exposed: "VirtualKeyId", source: "id" },
        ],
        joins: organizationTenantPath(),
      });

      const expectedBody =
        `SELECT\n` +
        `  "p"."id" AS "TenantId",\n` +
        `  "m"."id" AS "VirtualKeyId"\n` +
        `FROM "public"."VirtualKey" AS "m"\n` +
        `JOIN "public"."Team" AS "t" ON "m"."organizationId" = "t"."organizationId"\n` +
        `JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId"`;
      expect(statement).toContain(
        `CREATE OR REPLACE VIEW "public"."lwql_virtual_keys" AS\n${expectedBody}`,
      );
      expect(statement).toContain(
        `DROP VIEW IF EXISTS "public"."lwql_virtual_keys"`,
      );
      expect(statement).toContain(
        `CREATE VIEW "public"."lwql_virtual_keys" AS\n${expectedBody}`,
      );
    });
  });

  describe("when the base relation reaches its scope through a parent", () => {
    it("hops to the parent first, then appends the parent's org chain", () => {
      const statement = postgresApprovedViewStatement({
        schema: SCHEMA,
        view: "lwql_ledger_entries",
        baseRelation: "GatewayBudgetLedger",
        columns: [
          { exposed: "TenantId", source: "id", alias: "p" },
          { exposed: "LedgerEntryId", source: "id" },
        ],
        joins: parentTenantPath({
          parent: "GatewayBudget",
          foreignKey: "budgetId",
          alias: "gb",
          tail: organizationTenantPath(),
        }),
      });

      const expectedBody =
        `SELECT\n` +
        `  "p"."id" AS "TenantId",\n` +
        `  "m"."id" AS "LedgerEntryId"\n` +
        `FROM "public"."GatewayBudgetLedger" AS "m"\n` +
        `JOIN "public"."GatewayBudget" AS "gb" ON "m"."budgetId" = "gb"."id"\n` +
        `JOIN "public"."Team" AS "t" ON "gb"."organizationId" = "t"."organizationId"\n` +
        `JOIN "public"."Project" AS "p" ON "t"."id" = "p"."teamId"`;
      expect(statement).toContain(
        `CREATE OR REPLACE VIEW "public"."lwql_ledger_entries" AS\n${expectedBody}`,
      );
      expect(statement).toContain(
        `DROP VIEW IF EXISTS "public"."lwql_ledger_entries"`,
      );
      expect(statement).toContain(
        `CREATE VIEW "public"."lwql_ledger_entries" AS\n${expectedBody}`,
      );
    });
  });

  describe("when a rowFilter is given", () => {
    it("ANDs it into a WHERE clause after the join chain", () => {
      const statement = postgresApprovedViewStatement({
        schema: SCHEMA,
        view: "lwql_topics",
        baseRelation: "Topic",
        columns: [
          { exposed: "TenantId", source: "projectId" },
          { exposed: "TopicId", source: "id" },
        ],
        joins: projectTenantPath(),
        rowFilter: `"m"."isShared" = true`,
      });

      const expectedBody =
        `SELECT\n` +
        `  "m"."projectId" AS "TenantId",\n` +
        `  "m"."id" AS "TopicId"\n` +
        `FROM "public"."Topic" AS "m"\n` +
        `WHERE ("m"."isShared" = true)`;
      expect(statement).toContain(
        `CREATE OR REPLACE VIEW "public"."lwql_topics" AS\n${expectedBody}`,
      );
      expect(statement).toContain(
        `CREATE VIEW "public"."lwql_topics" AS\n${expectedBody}`,
      );
    });

    it("refuses a blank rowFilter", () => {
      expect(() =>
        postgresApprovedViewStatement({
          schema: SCHEMA,
          view: "lwql_topics",
          baseRelation: "Topic",
          columns: [{ exposed: "TenantId", source: "projectId" }],
          rowFilter: "   ",
        }),
      ).toThrow(/blank rowFilter/);
    });
  });

  const SIMPLE_COLUMNS = [{ exposed: "TenantId", source: "projectId" }];

  describe("the DO-block atomic upgrade path", () => {
    it("emits one statement: CREATE OR REPLACE first, DROP+CREATE only on the reorder SQLSTATEs", () => {
      const statement = postgresApprovedViewStatement({
        schema: SCHEMA,
        view: "lwql_topics",
        baseRelation: "Topic",
        columns: SIMPLE_COLUMNS,
      });

      expect(statement).toContain("DO $lwql$");
      expect(statement).toContain("CREATE OR REPLACE VIEW");
      expect(statement).toContain("EXCEPTION");
      // The two SQLSTATEs confirmed against a real PostgreSQL server: a
      // reorder, a drop, a rename or a retype all raise
      // invalid_table_definition (42P16). feature_not_supported is kept as
      // defense-in-depth even though no case here was observed to raise it.
      expect(statement).toContain(
        "WHEN feature_not_supported OR invalid_table_definition THEN",
      );
      expect(statement).toContain('DROP VIEW IF EXISTS "public"."lwql_topics"');
      expect(statement).toContain('CREATE VIEW "public"."lwql_topics" AS');
      expect(statement).toContain("END\n$lwql$");
    });

    it("refuses a view body containing the reserved dollar-quote tag", () => {
      expect(() =>
        postgresApprovedViewStatement({
          schema: SCHEMA,
          view: "lwql_topics",
          baseRelation: "Topic",
          columns: SIMPLE_COLUMNS,
          rowFilter: `"m"."x" = '$lwql$'`,
        }),
      ).toThrow(/reserved dollar-quote tag/);
    });

    describe("when a readerRole is given", () => {
      it("re-grants it only inside the fallback branch, guarded by a pg_roles probe", () => {
        const statement = postgresApprovedViewStatement({
          schema: SCHEMA,
          view: "lwql_topics",
          baseRelation: "Topic",
          columns: SIMPLE_COLUMNS,
          readerRole: "lwql_ro",
        });

        expect(statement).toContain(
          "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lwql_ro') THEN",
        );
        expect(statement).toContain(
          'GRANT SELECT ON "public"."lwql_topics" TO "lwql_ro"',
        );
        // The re-grant belongs to the fallback branch, so it must appear
        // after EXCEPTION, not inside the CREATE OR REPLACE arm.
        const exceptionAt = statement.indexOf("EXCEPTION");
        const grantAt = statement.indexOf("GRANT SELECT");
        expect(exceptionAt).toBeGreaterThan(-1);
        expect(grantAt).toBeGreaterThan(exceptionAt);
      });
    });

    describe("when no readerRole is given", () => {
      it("emits no GRANT at all", () => {
        const statement = postgresApprovedViewStatement({
          schema: SCHEMA,
          view: "lwql_topics",
          baseRelation: "Topic",
          columns: SIMPLE_COLUMNS,
        });

        expect(statement).not.toContain("GRANT SELECT");
      });
    });
  });

  describe("when a hop is malformed", () => {
    const columns = [{ exposed: "TenantId", source: "id", alias: "p" }];

    it("refuses a hop whose alias equals the base alias m", () => {
      expect(() =>
        postgresApprovedViewStatement({
          schema: SCHEMA,
          view: "lwql_x",
          baseRelation: "X",
          columns,
          joins: [
            {
              relation: "Project",
              alias: "m",
              on: { from: "teamId", to: "teamId" },
            },
          ],
        }),
      ).toThrow(/lwql provisioning: .*base alias "m"/);
    });

    it("refuses two hops sharing an alias", () => {
      expect(() =>
        postgresApprovedViewStatement({
          schema: SCHEMA,
          view: "lwql_x",
          baseRelation: "X",
          columns,
          joins: [
            {
              relation: "Team",
              alias: "t",
              on: { from: "organizationId", to: "organizationId" },
            },
            {
              relation: "Project",
              alias: "t",
              on: { from: "id", to: "teamId" },
            },
          ],
        }),
      ).toThrow(/lwql provisioning: .*reuses alias "t"/);
    });

    it("refuses a hop with an empty relation", () => {
      expect(() =>
        postgresApprovedViewStatement({
          schema: SCHEMA,
          view: "lwql_x",
          baseRelation: "X",
          columns,
          joins: [
            { relation: "", alias: "p", on: { from: "teamId", to: "teamId" } },
          ],
        }),
      ).toThrow(/lwql provisioning: .*empty relation/);
    });
  });
});
