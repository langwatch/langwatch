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
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_POSTGRES_READER_LIMITS,
  type PostgresReaderRole,
  postgresReaderRoleStatements,
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
