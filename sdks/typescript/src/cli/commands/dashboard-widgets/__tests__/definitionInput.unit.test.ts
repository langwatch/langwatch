import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { WidgetInputError, resolveUpdateDefinitionInput } from "../definitionInput";

const CURRENT = {
  code: "export default () => null;",
  queries: [{ name: "traces", sql: "SELECT count() AS value FROM analytics.traces" }],
};

describe("resolveUpdateDefinitionInput()", () => {
  describe("when neither code nor queries flags are given", () => {
    it("returns undefined without fetching the current widget", async () => {
      const fetchCurrent = vi.fn();

      const result = await resolveUpdateDefinitionInput({}, fetchCurrent);

      expect(result).toBeUndefined();
      expect(fetchCurrent).not.toHaveBeenCalled();
    });
  });

  describe("when only --code is given", () => {
    it("backfills queries from the widget currently saved", async () => {
      const fetchCurrent = vi.fn().mockResolvedValue(CURRENT);

      const result = await resolveUpdateDefinitionInput(
        { code: "new code" },
        fetchCurrent,
      );

      expect(result).toEqual({ code: "new code", queries: CURRENT.queries });
      expect(fetchCurrent).toHaveBeenCalledTimes(1);
    });
  });

  describe("when only --queries-file is given", () => {
    it("backfills code from the widget currently saved", async () => {
      const fetchCurrent = vi.fn().mockResolvedValue(CURRENT);
      const newQueries = [
        { name: "errors", sql: "SELECT count() AS value FROM analytics.errors" },
      ];
      const dir = mkdtempSync(join(tmpdir(), "widget-update-"));
      const queriesFile = join(dir, "queries.json");
      writeFileSync(queriesFile, JSON.stringify(newQueries));

      const result = await resolveUpdateDefinitionInput(
        { queriesFile },
        fetchCurrent,
      );

      expect(result).toEqual({ code: CURRENT.code, queries: newQueries });
      expect(fetchCurrent).toHaveBeenCalledTimes(1);
    });
  });

  describe("when both --code and --queries-file are given", () => {
    it("never fetches the current widget", async () => {
      const fetchCurrent = vi.fn();
      const dir = mkdtempSync(join(tmpdir(), "widget-update-"));
      const queriesFile = join(dir, "queries.json");
      writeFileSync(queriesFile, JSON.stringify(CURRENT.queries));

      const result = await resolveUpdateDefinitionInput(
        { code: "brand new code", queriesFile },
        fetchCurrent,
      );

      expect(result).toEqual({ code: "brand new code", queries: CURRENT.queries });
      expect(fetchCurrent).not.toHaveBeenCalled();
    });
  });

  describe("when both --code and --code-file are given", () => {
    it("refuses before ever fetching the current widget", async () => {
      const fetchCurrent = vi.fn();

      await expect(
        resolveUpdateDefinitionInput(
          { code: "a", codeFile: "b" },
          fetchCurrent,
        ),
      ).rejects.toThrow(WidgetInputError);

      expect(fetchCurrent).not.toHaveBeenCalled();
    });
  });
});
