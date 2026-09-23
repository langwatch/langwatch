/** The gateway spend metadata map must be content-gated (#8085 security finding 2: HIGH). */
import { describe, expect, it } from "vitest";

import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { GATEWAY_OVERRIDES } from "../lwql-gateway-overrides.rules.ts";
import { LWQL_VIEW_CATALOG, lwqlViewByName } from "../lwql-view-catalog.rules.ts";

const catalogShapes = LangWatchQLCatalogShapesService.create();

describe("given the gateway_request_spend view", () => {
  describe("when its metadata map is exposed", () => {
    it("declares the MetadataMap gate as output in the override", () => {
      expect(GATEWAY_OVERRIDES.gateway_spend?.columnGates?.MetadataMap).toEqual(["output"]);
    });

    it("carries the output gate on the built column", () => {
      const view = lwqlViewByName("gateway_request_spend");
      expect(view, "gateway_request_spend must be in the catalog").toBeDefined();
      const column = view!.columns.find((c) => c.name === "MetadataMap");
      expect(column, "MetadataMap must be an exposed column").toBeDefined();
      expect(column!.gates).toContain("output");
    });

    it("is reported as a content-gated column of the catalog", () => {
      expect(catalogShapes.contentGatedColumns(LWQL_VIEW_CATALOG)).toContain("MetadataMap");
    });
  });
});
