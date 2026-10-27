/**
 * The default row `LIMIT` the service appends to a statement naming none.
 * @see specs/lwql/result-paging.feature
 */
import { describe, expect, it } from "vitest";

import { validateLangWatchQL } from "../../langwatch-ql/__tests__/lwql-validate.ts";
import { appendDefaultRowLimit } from "../langwatch-ql-row-limit.rules.ts";

describe("appendDefaultRowLimit", () => {
  describe("given a statement that names no LIMIT and no OFFSET", () => {
    it("appends the cap on its own line, leaving the submitted text a prefix", () => {
      const sql = "SELECT   TraceId,\n  count() AS n\nFROM analytics.traces\nGROUP BY TraceId";

      expect(appendDefaultRowLimit({ sql, maxRows: 10_000 })).toBe(`${sql}\nLIMIT 10000`);
    });

    it("strips a trailing semicolon so the LIMIT is not a second statement", () => {
      expect(appendDefaultRowLimit({ sql: "SELECT 1 ;  \n", maxRows: 5 })).toBe(
        "SELECT 1\nLIMIT 5",
      );
    });

    it("keeps a trailing line comment from swallowing the LIMIT", () => {
      expect(appendDefaultRowLimit({ sql: "SELECT 1 -- note", maxRows: 5 })).toBe(
        "SELECT 1 -- note\nLIMIT 5",
      );
    });
  });

  describe("given a statement that names only an OFFSET", () => {
    it("inserts the cap immediately before the OFFSET keyword", () => {
      const sql = "SELECT TraceId FROM traces OFFSET 40";

      expect(
        appendDefaultRowLimit({ sql, maxRows: 10_000, beforeOffset: { line: 1, column: 35 } }),
      ).toBe("SELECT TraceId FROM traces LIMIT 10000 OFFSET 40");
    });

    it("finds the keyword on an earlier line than the value", () => {
      const sql = "SELECT TraceId\nFROM traces\nOFFSET\n  40";

      expect(appendDefaultRowLimit({ sql, maxRows: 7, beforeOffset: { line: 4, column: 3 } })).toBe(
        "SELECT TraceId\nFROM traces\nLIMIT 7 OFFSET\n  40",
      );
    });
  });

  describe("given the position the validator reports for that OFFSET", () => {
    it("produces a statement that validates with its own LIMIT", () => {
      const sql = "SELECT TraceId FROM traces ORDER BY TraceId OFFSET 40";
      const validation = validateLangWatchQL({
        sql,
        allowedTables: ["analytics.traces"],
        gatedColumns: [],
        defaultDatabase: "analytics",
      });
      if (!validation.ok || !validation.appendRowLimitBeforeOffset) {
        throw new Error("the statement should be accepted and flagged for an append");
      }

      const appended = appendDefaultRowLimit({
        sql,
        maxRows: 10_000,
        beforeOffset: validation.appendRowLimitBeforeOffset,
      });

      expect(appended).toBe("SELECT TraceId FROM traces ORDER BY TraceId LIMIT 10000 OFFSET 40");
    });
  });
});
