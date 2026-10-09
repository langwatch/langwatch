import { describe, expect, it } from "vitest";
import { narrowMapColumnProjection } from "../clickhouse.field-mappings.mapper.ts";
import {
  latestVersionSubquery,
  parseLatestVersionColumn,
} from "../clickhouse.latest-version-dedup.mapper.ts";

describe("parseLatestVersionColumn", () => {
  describe("when the entry is a bare identifier", () => {
    it("names the column with no expression", () => {
      expect(parseLatestVersionColumn(" TotalCost ")).toEqual({
        name: "TotalCost",
      });
    });
  });

  describe("when the entry is an aliased expression", () => {
    it("splits the expression from the alias", () => {
      expect(
        parseLatestVersionColumn("CAST(TotalCost AS String) AS CostText"),
      ).toEqual({ name: "CostText", expression: "CAST(TotalCost AS String)" });
    });
  });
});

describe("latestVersionSubquery", () => {
  const build = (columns: string[]) =>
    latestVersionSubquery({
      table: "trace_summaries",
      alias: "ts",
      keyColumns: ["TenantId", "TraceId"],
      columns: columns.map(parseLatestVersionColumn),
      where: "TenantId = {tenantId:String}",
    });

  describe("when the version column is requested bare", () => {
    it("exposes it as max(version) instead of carrying it in the tuple", () => {
      const sql = build(["TotalCost", "UpdatedAt"]);

      expect(sql).toContain("max(__version) AS UpdatedAt");
      expect(sql).toContain("tuple(TotalCost) AS __latest_row");
    });
  });

  describe("when a key column or a duplicate is in the column list", () => {
    it("groups on the key and carries every other column once", () => {
      const sql = build(["TraceId", "TotalCost", "TotalCost"]);

      expect(sql).toContain("tuple(TotalCost) AS __latest_row");
      expect(sql).toContain("tupleElement(__latest, 1) AS TotalCost");
      expect(sql).not.toContain("tupleElement(__latest, 2)");
      expect(sql).toContain("GROUP BY TenantId, TraceId");
    });
  });

  describe("when only keys are requested", () => {
    it("collapses without an argMax tuple", () => {
      const sql = build(["TraceId"]);

      expect(sql).not.toContain("argMax");
      expect(sql).toContain("GROUP BY TenantId, TraceId");
    });
  });
});

describe("narrowMapColumnProjection", () => {
  describe("when every reference is a literal keyed access", () => {
    it("rebuilds the map from just those keys", () => {
      expect(
        narrowMapColumnProjection({
          column: "Attributes",
          expressions: [
            "ts.Attributes['langwatch.user_id']",
            "Attributes['langwatch.user_id'] != ''",
            "ts.Attributes['langwatch.labels']",
          ],
        }),
      ).toBe(
        "map('langwatch.user_id', Attributes['langwatch.user_id'], 'langwatch.labels', Attributes['langwatch.labels']) AS Attributes",
      );
    });
  });

  describe("when the map is used as a whole", () => {
    it("returns null so the caller keeps the whole map", () => {
      expect(
        narrowMapColumnProjection({
          column: "Attributes",
          expressions: [
            "ts.Attributes['langwatch.user_id']",
            "mapKeys(ts.Attributes)",
          ],
        }),
      ).toBeNull();
    });
  });

  describe("when a key is a query parameter", () => {
    it("returns null so the caller keeps the whole map", () => {
      expect(
        narrowMapColumnProjection({
          column: "Attributes",
          expressions: ["ts.Attributes[{p_key:String}] IN ({p:Array(String)})"],
        }),
      ).toBeNull();
    });
  });

  describe("when another column only ends with the same name", () => {
    it("does not count it as a reference", () => {
      expect(
        narrowMapColumnProjection({
          column: "Attributes",
          expressions: ["ts.Attributes['k']", "mapKeys(ss.SpanAttributes)"],
        }),
      ).toBe("map('k', Attributes['k']) AS Attributes");
    });
  });
});
