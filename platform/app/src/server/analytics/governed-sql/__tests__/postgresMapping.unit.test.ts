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
 * @see specs/analytics/governed-sql-api.feature
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
    approvedViews: ["governed_traces"],
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
});
