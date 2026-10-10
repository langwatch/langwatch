/**
 * specs/otlp/endpoint-path-canonicalisation.feature — the corrected-path marker.
 * The path mapping itself is covered in
 * packages/observability/src/__tests__/otlp-path.unit.test.ts.
 */

import { describe, expect, it } from "vitest";

import { readCorrectedPath, stampCorrectedPath } from "../path-canonicalisation.ts";

describe("the corrected-path marker", () => {
  /** @scenario The correction names the path the exporter used */
  it("carries the path the exporter used back to the receiver", () => {
    const headers = new Headers();
    stampCorrectedPath({
      headers,
      originalPath: "/api/otel/v1/traces/v1/logs",
    });

    expect(readCorrectedPath(headers.get("x-langwatch-otlp-corrected-path") ?? void 0)).toBe(
      "/api/otel/v1/traces/v1/logs",
    );
  });

  describe("when the caller supplies the header itself", () => {
    /** @scenario A caller cannot claim its path was corrected */
    it("discards a marker this process did not write", () => {
      expect(readCorrectedPath("/api/otel/v1/traces/v1/logs")).toBeNull();
      expect(
        readCorrectedPath("00000000-0000-0000-0000-000000000000 /api/otel/v1/traces/v1/logs"),
      ).toBeNull();
      expect(readCorrectedPath(void 0)).toBeNull();
    });
  });
});
