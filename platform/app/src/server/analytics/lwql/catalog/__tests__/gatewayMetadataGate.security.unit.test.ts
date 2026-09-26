/**
 * The gateway spend metadata map must be content-gated (#8085 security finding
 * 2: HIGH).
 *
 * `gateway_spend.MetadataMap` (migration 00076) is `Map(String, String)`
 * materialised from the free-form `Metadata` JSON, which the default classifier
 * gates `output`. Every exposed map is content-*filtered* rather than gated, but
 * the filter (`contentGating.ts`) only strips known LLM-content keys
 * (`gen_ai.prompt`, …) — never arbitrary customer metadata keys/values. So the
 * map re-exposes the same captured content its own source column is gated for
 * unless it carries the same gate. This pins that gate.
 */
import { describe, expect, it } from "vitest";
import { LWQL_VIEW_CATALOG, lwqlViewByName } from "../lwqlViews";
import { GATEWAY_OVERRIDES } from "../overrides/gateway";
import { lwqlContentGatedColumns } from "../types";

describe("given the gateway_request_spend view", () => {
  describe("when its metadata map is exposed", () => {
    it("declares the MetadataMap gate as output in the override", () => {
      expect(GATEWAY_OVERRIDES.gateway_spend?.columnGates?.MetadataMap).toEqual(
        ["output"],
      );
    });

    it("carries the output gate on the built column", () => {
      const view = lwqlViewByName("gateway_request_spend");
      expect(
        view,
        "gateway_request_spend must be in the catalog",
      ).toBeDefined();
      const column = view!.columns.find((c) => c.name === "MetadataMap");
      expect(column, "MetadataMap must be an exposed column").toBeDefined();
      expect(column!.gates).toContain("output");
    });

    it("is reported as a content-gated column of the catalog", () => {
      expect(lwqlContentGatedColumns(LWQL_VIEW_CATALOG)).toContain(
        "MetadataMap",
      );
    });
  });
});
