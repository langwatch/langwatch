/**
 * `statementTarget` and `statementKind` are what lets the runner log a failed
 * statement without ever logging the statement itself: the target identifies
 * which config-store entity (if any) a statement's own effect lands on, and
 * the kind gives a safe leading-keyword label for the log line. Split out of
 * `clickhouseStatementRunner.ts` by issue #8274; these cases exercised the
 * same functions in that file before the move.
 *
 * @see ../statementTarget.ts
 * @see ../clickhouseStatementRunner.ts — toleratedConfigStoreSkipCode matches a
 *   parsed target against the config-store inventory
 * @see specs/lwql/api.feature
 */

import { describe, expect, it } from "vitest";

import {
  assertPlainIdentifier,
  statementKind,
  statementTarget,
} from "../statementTarget";

describe("statementTarget", () => {
  describe("given a row policy statement", () => {
    it("captures the short name, database and table from an ON db.table clause", () => {
      expect(
        statementTarget(
          "CREATE ROW POLICY x_tenant ON langwatch.traces USING TenantId = 1",
        ),
      ).toEqual({
        kind: "row_policy",
        name: "x_tenant",
        database: "langwatch",
        table: "traces",
      });
    });

    it("leaves database undefined when the ON clause names no database", () => {
      expect(statementTarget("DROP ROW POLICY x_tenant ON traces")).toEqual({
        kind: "row_policy",
        name: "x_tenant",
        database: undefined,
        table: "traces",
      });
    });

    it("matches case-insensitively and accepts backticked identifiers", () => {
      expect(
        statementTarget(
          "alter row policy `x_tenant` on `langwatch`.`traces` using 1",
        ),
      ).toEqual({
        kind: "row_policy",
        name: "x_tenant",
        database: "langwatch",
        table: "traces",
      });
    });
  });

  describe("given a user statement", () => {
    it("captures the name from CREATE USER", () => {
      expect(
        statementTarget(
          "CREATE USER OR REPLACE langwatch_lwql IDENTIFIED WITH sha256_password BY 'x'",
        ),
      ).toEqual({ kind: "user", name: "langwatch_lwql" });
    });

    it("captures the name from ALTER USER and DROP USER", () => {
      expect(
        statementTarget("ALTER USER langwatch_lwql SETTINGS PROFILE p"),
      ).toEqual({ kind: "user", name: "langwatch_lwql" });
      expect(statementTarget("DROP USER IF EXISTS langwatch_lwql")).toEqual({
        kind: "user",
        name: "langwatch_lwql",
      });
    });

    it("captures the grantee from GRANT ... TO, not the privilege or object", () => {
      expect(
        statementTarget("GRANT SELECT ON langwatch.traces TO langwatch_lwql"),
      ).toEqual({ kind: "user", name: "langwatch_lwql" });
    });

    it("captures the revokee from REVOKE ... FROM", () => {
      expect(
        statementTarget(
          "REVOKE SELECT ON langwatch.traces FROM langwatch_lwql",
        ),
      ).toEqual({ kind: "user", name: "langwatch_lwql" });
    });
  });

  describe("given a settings profile statement", () => {
    it("captures the name, anchored on SETTINGS PROFILE rather than USER", () => {
      expect(
        statementTarget("CREATE SETTINGS PROFILE OR REPLACE lwql_restricted"),
      ).toEqual({ kind: "settings_profile", name: "lwql_restricted" });
    });

    it("still targets the user for CREATE USER ... SETTINGS PROFILE <p>", () => {
      // A settings-profile *clause* on a CREATE USER must not be mistaken for
      // a CREATE SETTINGS PROFILE statement — the pattern anchors on USER.
      expect(
        statementTarget(
          "CREATE USER langwatch_lwql SETTINGS PROFILE lwql_restricted",
        ),
      ).toEqual({ kind: "user", name: "langwatch_lwql" });
    });
  });

  describe("given a statement with no config-store target", () => {
    it("returns null for a table or view statement", () => {
      expect(
        statementTarget("CREATE OR REPLACE VIEW langwatch.traces AS SELECT 1"),
      ).toBeNull();
      expect(
        statementTarget("CREATE DATABASE IF NOT EXISTS langwatch"),
      ).toBeNull();
    });

    it("returns null for a named collection statement", () => {
      expect(
        statementTarget("DROP NAMED COLLECTION IF EXISTS lwql_postgres"),
      ).toBeNull();
    });
  });
});

describe("assertPlainIdentifier", () => {
  it("returns a bare alphanumeric/underscore name unchanged", () => {
    expect(assertPlainIdentifier("langwatch_lwql")).toBe("langwatch_lwql");
  });

  it("refuses a name carrying a quote, rather than letting it reach a query", () => {
    expect(() => assertPlainIdentifier("x' OR '1'='1")).toThrow(
      /refusing to interpolate/,
    );
  });

  it("refuses an empty name", () => {
    expect(() => assertPlainIdentifier("")).toThrow(/refusing to interpolate/);
  });
});

describe("statementKind", () => {
  it("reduces GRANT and REVOKE to the bare verb, never the grantee", () => {
    expect(statementKind("GRANT SELECT ON langwatch.traces TO lwql")).toBe(
      "GRANT",
    );
    expect(statementKind("REVOKE SELECT ON langwatch.traces FROM lwql")).toBe(
      "REVOKE",
    );
  });

  it("drops OR REPLACE and IF [NOT] EXISTS as noise", () => {
    expect(
      statementKind(
        "CREATE USER OR REPLACE langwatch_lwql IDENTIFIED WITH sha256_password BY 'x'",
      ),
    ).toBe("CREATE USER");
    expect(statementKind("DROP NAMED COLLECTION IF EXISTS lwql_postgres")).toBe(
      "DROP NAMED COLLECTION",
    );
  });

  it("collects up to three leading object keywords", () => {
    expect(statementKind("CREATE ROW POLICY x ON t USING 1")).toBe(
      "CREATE ROW POLICY",
    );
  });

  it("never includes an identifier, quote or value", () => {
    const kind = statementKind(
      "CREATE USER OR REPLACE langwatch_lwql IDENTIFIED WITH sha256_password BY 's3cr3t'",
    );
    expect(kind).not.toContain("langwatch_lwql");
    expect(kind).not.toContain("s3cr3t");
  });

  it("returns UNKNOWN for a statement with no leading keyword", () => {
    expect(statementKind("123 not a statement")).toBe("UNKNOWN");
  });
});
