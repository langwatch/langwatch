import { SEARCH_FIELDS } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { builtTraceFilter } from "../../../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { FACET_REGISTRY } from "../clickhouse.trace-facet-registry.mapper.ts";

const TIME_RANGE = { from: 1714435200000, to: 1715040000000 };

const translate = (query: string) =>
  builtTraceFilter({
    queryText: query,
    timeRange: TIME_RANGE,
  });

/** evaluatorLabel is wired the same way as evaluatorVerdict: a categorical
 * facet on evaluation_runs, auto-derived into a partition-pruned subquery on
 * the Label column. The drilldown's clickable label rows depend on this. */
describe("evaluatorLabel facet", () => {
  describe("when registered", () => {
    it("lives in FACET_REGISTRY as an evaluation_runs categorical on Label", () => {
      const def = FACET_REGISTRY.find((d) => d.key === "evaluatorLabel");
      expect(def).toBeDefined();
      expect(def).toMatchObject({
        kind: "categorical",
        table: "evaluation_runs",
        expression: "Label",
      });
    });

    it("is surfaced in SEARCH_FIELDS so the search bar can suggest it", () => {
      expect(SEARCH_FIELDS.evaluatorLabel).toBeDefined();
    });
  });

  describe("when translating evaluatorLabel:<value> to ClickHouse", () => {
    it("emits a partition-pruned evaluation_runs subquery on Label", () => {
      const result = translate("evaluatorLabel:toxic");
      expect(result).not.toBeNull();
      // Cross-table subquery against evaluation_runs (mirrors evaluatorVerdict).
      expect(result!.sql).toContain("evaluation_runs");
      expect(result!.sql).toContain("ScheduledAt >=");
      expect(result!.sql).toContain("Label = {v2:String}");
      expect(result!.bound.v2).toBe("toxic");
      expect(Object.values(result!.params)).toContain("toxic");
    });

    it("mirrors evaluatorVerdict's subquery shape (only the column differs)", () => {
      const label = translate("evaluatorLabel:toxic");
      const verdict = translate("evaluatorVerdict:pass");
      const normalise = (s: string) =>
        s
          .replace(/\{v\d+:[A-Za-z0-9()]+\}/g, "{P}")
          // Collapse the differing column expression so the surrounding
          // subquery scaffolding can be compared directly.
          .replace(/AND Label = \{P\}\)\)$/, "AND {COL}))")
          .replace(/AND multiIf\(.*\) = \{P\}\)\)$/, "AND {COL}))");
      expect(normalise(label!.sql)).toBe(normalise(verdict!.sql));
    });
  });
});
