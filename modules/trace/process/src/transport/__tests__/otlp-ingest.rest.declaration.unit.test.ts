/**
 * @vitest-environment node
 * The receiver's wire-body caps, pinned: the raw-body middleware buffers the
 * whole body before in-handler auth, so the declared cap is what keeps an
 * unauthenticated oversized POST from allocating pod memory.
 */
import { resolveRequestBound } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { otlpIngestRest } from "../otlp-ingest.rest.ts";

const declaration = otlpIngestRest.router();

const RECEIVERS = ["ingestOtlpTraces"];
const ALIASES = [
  "ingestOtlpTracesAlias",
  "ingestOtlpTracesAliasSlash",
  "ingestOtlpTracesRootV1",
  "ingestOtlpTracesRootV1Slash",
];

describe("the OTLP receiver family", () => {
  describe("given the declaration a process mounts", () => {
    it("caps every receiver's wire body at the registry's bulk bound", () => {
      const caps = Object.fromEntries(
        declaration.routes.map((route) => [route.operation, route.bodyLimit?.maxBytes]),
      );

      for (const operation of [...RECEIVERS, ...ALIASES]) {
        expect(caps[operation]).toBe(resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE"));
      }
    });

    it("still reads the raw bytes every receiver parses", () => {
      for (const route of declaration.routes) {
        expect([route.operation, route.rawBody?.form]).toEqual([route.operation, "bytes"]);
      }
    });

    it("serves only the traces suffix, leaving logs and metrics to their own modules", () => {
      expect(declaration.addressing).toBe("literal");
      expect(declaration.routes.map((route) => route.path)).toEqual([
        "/api/otel/v1/traces",
        "/:otlpBase{.+}/v1/traces",
        "/:otlpBase{.+}/v1/traces/",
        "/v1/traces",
        "/v1/traces/",
      ]);
    });
  });
});
