import { describe, it, expect } from "vitest";
import { DataGridUrlParams } from "../datagrid-url-params.util";

const { parse, serialize, merge, hasChanged, DEFAULTS } = DataGridUrlParams;

describe("DataGridUrlParams", () => {
  describe("parse", () => {
    it("returns empty object for empty string", () => {
      expect(parse("")).toEqual({});
    });

    it("parses single filter", () => {
      const result = parse(
        "filters[0][columnId]=status&filters[0][operator]=eq&filters[0][value]=FAILED"
      );
      expect(result.filters).toEqual([
        { columnId: "status", operator: "eq", value: "FAILED" },
      ]);
    });

    it("parses multiple filters", () => {
      const result = parse(
        "filters[0][columnId]=status&filters[0][operator]=eq&filters[0][value]=FAILED&filters[1][columnId]=name&filters[1][operator]=contains&filters[1][value]=login"
      );
      expect(result.filters).toHaveLength(2);
      expect(result.filters?.[0]?.columnId).toBe("status");
      expect(result.filters?.[1]?.columnId).toBe("name");
    });

    it("parses sorting", () => {
      const result = parse("sortBy=timestamp&sortOrder=desc");
      expect(result.sorting).toEqual({ columnId: "timestamp", order: "desc" });
    });

    it("defaults sort order to desc when missing", () => {
      const result = parse("sortBy=timestamp");
      expect(result.sorting).toEqual({ columnId: "timestamp", order: "desc" });
    });

    it("parses pagination", () => {
      const result = parse("page=3&pageSize=50");
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(50);
    });

    it("ignores invalid page values", () => {
      const result = parse("page=-1&pageSize=0");
      expect(result.page).toBeUndefined();
      expect(result.pageSize).toBeUndefined();
    });

    it("caps pageSize at 100", () => {
      const result = parse("pageSize=500");
      expect(result.pageSize).toBeUndefined();
    });

    it("parses search", () => {
      const result = parse("search=login%20error");
      expect(result.globalSearch).toBe("login error");
    });

    it("parses groupBy", () => {
      const result = parse("groupBy=status");
      expect(result.groupBy).toBe("status");
    });

    it("handles complex filter values", () => {
      const result = parse(
        "filters[0][columnId]=timestamp&filters[0][operator]=eq&filters[0][value]=1702900000000"
      );
      expect(result.filters?.[0]?.value).toBe("1702900000000");
    });

    it("filters out invalid filters without columnId", () => {
      const result = parse("filters[0][operator]=eq&filters[0][value]=test");
      expect(result.filters).toEqual([]);
    });
  });

  describe("serialize", () => {
    it("returns empty string for default state", () => {
      const result = serialize(DEFAULTS);
      expect(result).toBe("");
    });

    it("serializes single filter", () => {
      const result = serialize({
        filters: [{ columnId: "status", operator: "eq", value: "FAILED" }],
      });
      // qs encodes brackets as %5B and %5D
      expect(result).toContain("filters%5B0%5D%5BcolumnId%5D=status");
      expect(result).toContain("filters%5B0%5D%5Boperator%5D=eq");
      expect(result).toContain("filters%5B0%5D%5Bvalue%5D=FAILED");
    });

    it("serializes sorting", () => {
      const result = serialize({
        sorting: { columnId: "timestamp", order: "desc" },
      });
      expect(result).toContain("sortBy=timestamp");
      expect(result).toContain("sortOrder=desc");
    });

    it("omits default page and pageSize", () => {
      const result = serialize({ page: 1, pageSize: 20 });
      expect(result).toBe("");
    });

    it("includes non-default page and pageSize", () => {
      const result = serialize({ page: 3, pageSize: 50 });
      expect(result).toContain("page=3");
      expect(result).toContain("pageSize=50");
    });

    it("serializes search", () => {
      const result = serialize({ globalSearch: "login error" });
      expect(result).toContain("search=login%20error");
    });

    it("serializes groupBy", () => {
      const result = serialize({ groupBy: "status" });
      expect(result).toContain("groupBy=status");
    });

    it("omits empty globalSearch", () => {
      const result = serialize({ globalSearch: "" });
      expect(result).toBe("");
    });
  });

  describe("parse and serialize roundtrip", () => {
    it("roundtrips complex state", () => {
      const original = {
        filters: [
          { columnId: "status", operator: "eq" as const, value: "FAILED" },
          { columnId: "name", operator: "contains" as const, value: "test" },
        ],
        sorting: { columnId: "timestamp", order: "desc" as const },
        page: 2,
        pageSize: 50,
        globalSearch: "error",
        groupBy: "status",
      };

      const serialized = serialize(original);
      const parsed = parse(serialized);

      expect(parsed.filters).toEqual(original.filters);
      expect(parsed.sorting).toEqual(original.sorting);
      expect(parsed.page).toBe(original.page);
      expect(parsed.pageSize).toBe(original.pageSize);
      expect(parsed.globalSearch).toBe(original.globalSearch);
      expect(parsed.groupBy).toBe(original.groupBy);
    });
  });

  describe("merge", () => {
    it("URL state takes priority over existing state", () => {
      const urlState = { page: 5 };
      const existingState = { page: 1, pageSize: 50 };

      const result = merge(urlState, existingState);

      expect(result.page).toBe(5);
      expect(result.pageSize).toBe(50);
    });

    it("falls back to existing state when URL is empty", () => {
      const urlState = {};
      const existingState = {
        filters: [{ columnId: "status", operator: "eq" as const, value: "FAILED" }],
      };

      const result = merge(urlState, existingState);

      expect(result.filters).toEqual(existingState.filters);
    });

    it("falls back to defaults when both are empty", () => {
      const result = merge({}, {});

      expect(result).toEqual(DEFAULTS);
    });
  });

  describe("hasChanged", () => {
    it("returns false for identical states", () => {
      const state = {
        filters: [{ columnId: "status", operator: "eq" as const, value: "FAILED" }],
        page: 1,
      };

      expect(hasChanged(state, state)).toBe(false);
    });

    it("returns true when filters change", () => {
      const oldState = { filters: [] };
      const newState = {
        filters: [{ columnId: "status", operator: "eq" as const, value: "FAILED" }],
      };

      expect(hasChanged(newState, oldState)).toBe(true);
    });

    it("returns true when sorting changes", () => {
      const oldState = { sorting: null };
      const newState = { sorting: { columnId: "timestamp", order: "desc" as const } };

      expect(hasChanged(newState, oldState)).toBe(true);
    });

    it("returns true when page changes", () => {
      expect(hasChanged({ page: 2 }, { page: 1 })).toBe(true);
    });

    it("returns true when search changes", () => {
      expect(hasChanged({ globalSearch: "new" }, { globalSearch: "old" })).toBe(true);
    });
  });
});
