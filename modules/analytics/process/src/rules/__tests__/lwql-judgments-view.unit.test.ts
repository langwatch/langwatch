/** The `judgments` dataset's catalog entry. */

import { describe, expect, it } from "vitest";

import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { pickLwqlViewByName } from "../lwql-view-catalog.rules.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();

function judgments() {
  const view = pickLwqlViewByName("judgments");
  if (!view) throw new Error("the judgments dataset is not in the catalog");
  return view;
}

describe("given the judgments dataset in the LangWatchQL catalog", () => {
  describe("when the catalog entry is read", () => {
    /** @scenario The dataset is listed for every caller */
    it("carries no content gate, on the dataset or on any column", () => {
      const view = judgments();

      expect(view.gates).toEqual([]);
      expect(view.columns.filter((column) => catalogShapes.isContentGated(column))).toEqual([]);
    });

    /** @scenario The dataset declares its join keys and its time column */
    it("joins on the tenant and the trace id, and prunes on the write time", () => {
      const view = judgments();

      expect(view.joinKeys).toEqual(["TenantId", "TraceId"]);
      expect(view.timeColumn).toBe("CreatedAt");
      // A caller who writes the time predicate the schema publishes has to
      // land on the partition key, or the pruning the column promises does not
      // happen. Migration 00097 partitions by `toYYYYMM(CreatedAt)`.
      expect(view.columns.map((column) => column.name)).toContain(view.timeColumn);
    });
  });
});
