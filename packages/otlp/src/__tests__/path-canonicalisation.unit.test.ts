/**
 * specs/otlp/endpoint-path-canonicalisation.feature — the path mapping itself.
 * The routing that uses it is covered in
 * routes/__tests__/otel.path-aliases.unit.test.ts.
 */

import { describe, expect, it } from "vitest";
import {
  canonicalOtlpPath,
  readCorrectedPath,
  stampCorrectedPath,
} from "../path-canonicalisation";

describe("canonicalOtlpPath", () => {
  describe("given a base endpoint that already named a signal", () => {
    /** @scenario An endpoint that already named a signal */
    it("maps the appended signal onto its canonical path", () => {
      expect(canonicalOtlpPath("/api/otel/v1/traces/v1/logs")).toBe("/api/otel/v1/logs");
    });

    /** @scenario A metrics suffix under a traces base is metric ingestion */
    it("takes the signal from the suffix, not the base", () => {
      expect(canonicalOtlpPath("/api/otel/v1/traces/v1/metrics")).toBe(
        "/api/otel/v1/metrics",
      );
      expect(canonicalOtlpPath("/api/otel/v1/logs/v1/traces")).toBe(
        "/api/otel/v1/traces",
      );
    });
  });

  describe("given a base endpoint that named the collector", () => {
    /** @scenario An endpoint that named the collector */
    it("maps the collector-prefixed path onto its canonical path", () => {
      expect(canonicalOtlpPath("/api/collector/api/otel/v1/traces")).toBe(
        "/api/otel/v1/traces",
      );
      expect(canonicalOtlpPath("/api/collector/v1/traces")).toBe("/api/otel/v1/traces");
    });
  });

  describe("given a base endpoint that named a root", () => {
    /** @scenario An endpoint that named the site root */
    it("maps a root-level signal path onto its canonical path", () => {
      expect(canonicalOtlpPath("/v1/traces")).toBe("/api/otel/v1/traces");
      expect(canonicalOtlpPath("/api/v1/traces")).toBe("/api/otel/v1/traces");
    });
  });

  describe("given a path that is already canonical", () => {
    it("reports the canonical path it is on", () => {
      expect(canonicalOtlpPath("/api/otel/v1/traces")).toBe("/api/otel/v1/traces");
    });

    /** @scenario An endpoint with a stray trailing slash */
    it("normalises stray slashes to it", () => {
      expect(canonicalOtlpPath("/api/otel/v1/traces/")).toBe("/api/otel/v1/traces");
      expect(canonicalOtlpPath("/api/otel/v1//traces")).toBe("/api/otel/v1/traces");
    });
  });

  describe("given a path no misconfiguration produces", () => {
    /** @scenario An unrelated path that happens to end in a signal name */
    it("claims nothing outside the recognised prefixes", () => {
      expect(canonicalOtlpPath("/api/gateway/v1/traces")).toBeNull();
      expect(canonicalOtlpPath("/api/rum/v1/traces")).toBeNull();
      expect(canonicalOtlpPath("/api/ingest/otel/src_123/v1/traces")).toBeNull();
    });

    /** @scenario A path naming something other than a signal */
    it("claims nothing whose suffix is not a signal", () => {
      expect(canonicalOtlpPath("/api/otel/v1/traces/v1/profiles")).toBeNull();
      expect(canonicalOtlpPath("/api/otel/v1/traces/v2/traces")).toBeNull();
      expect(canonicalOtlpPath("/api/collector")).toBeNull();
      expect(canonicalOtlpPath("/")).toBeNull();
    });
  });
});

describe("the corrected-path marker", () => {
  /** @scenario The correction names the path the exporter used */
  it("carries the path the exporter used back to the receiver", () => {
    const headers = new Headers();
    stampCorrectedPath({
      headers,
      originalPath: "/api/otel/v1/traces/v1/logs",
    });

    expect(
      readCorrectedPath(headers.get("x-langwatch-otlp-corrected-path") ?? void 0),
    ).toBe("/api/otel/v1/traces/v1/logs");
  });

  describe("when the caller supplies the header itself", () => {
    /** @scenario A caller cannot claim its path was corrected */
    it("discards a marker this process did not write", () => {
      expect(readCorrectedPath("/api/otel/v1/traces/v1/logs")).toBeNull();
      expect(
        readCorrectedPath(
          "00000000-0000-0000-0000-000000000000 /api/otel/v1/traces/v1/logs",
        ),
      ).toBeNull();
      expect(readCorrectedPath(void 0)).toBeNull();
    });
  });
});
