/**
 * Every gate a view column names is one the visibility policy can grant.
 * @see ../lwql-gate.rules.ts
 */
import { ALL_PERMISSIONS } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

/** Content the data-privacy policy shows, and permissions the authz registry defines. */
const DEFINED_GATES = new Set<string>(["input", "output", ...ALL_PERMISSIONS]);

describe("given the shipped view catalogue", () => {
  describe("when each column's gates are read", () => {
    it("names only content gates and registry permissions", () => {
      const undefinedGates = LWQL_VIEW_CATALOG.flatMap((view) =>
        view.columns.flatMap((column) =>
          column.gates
            .filter((gate) => !DEFINED_GATES.has(gate))
            .map((gate) => `${view.name}.${column.name}: ${gate}`),
        ),
      );

      expect(undefinedGates).toEqual([]);
    });

    it("gates cost with the cost:view permission", () => {
      const totalCost = LWQL_VIEW_CATALOG.find((view) => view.name === "traces")?.columns.find(
        (column) => column.name === "TotalCost",
      );

      expect(totalCost?.gates).toEqual(["cost:view"]);
    });
  });
});
