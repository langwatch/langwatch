/**
 * @vitest-environment node
 * The receiver's wire-body caps, pinned: the raw-body middleware buffers the
 * whole body before in-handler auth, so the declared cap is what keeps an
 * unauthenticated oversized POST from allocating pod memory.
 */
import { describe, expect, it } from "vitest";

import { otlpIngestRest } from "../otlp-ingest.rest.ts";

const declaration = otlpIngestRest.router();

const RECEIVERS = ["ingestOtlpTraces"];

describe("the OTLP receiver family", () => {
  describe("given the declaration a process mounts", () => {
    it("caps every receiver's wire body at the deployment's trace body setting", () => {
      for (const operation of RECEIVERS) {
        const cap = declaration.routes.find((route) => route.operation === operation)?.bodyLimit;
        expect(typeof cap?.maxBytes).toBe("function");
        const resolve = cap?.maxBytes as (app: { otlpTracesMaxBodyBytes(): number }) => number;
        expect(resolve({ otlpTracesMaxBodyBytes: () => 12_345 })).toBe(12_345);
      }
    });

    it("still reads the raw bytes every receiver parses", () => {
      for (const route of declaration.routes) {
        expect([route.operation, route.rawBody?.form]).toEqual([route.operation, "bytes"]);
      }
    });

    it("declares only the canonical traces route; the host rewrites exporter aliases onto it", () => {
      expect(declaration.addressing).toBe("literal");
      expect(declaration.routes.map((route) => route.path)).toEqual(["/api/otel/v1/traces"]);
    });
  });
});
