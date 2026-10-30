import { describe, expect, it, vi } from "vitest";

import {
  canonicalOtlpPath,
  OTLP_CORRECTED_PATH_HEADER,
  readCorrectedPath,
  stampCorrectedPath,
} from "../request/otlp-path.ts";

// Hoisted above the import, so a secret minted on load is counted; read before any test
// runs, since mock calls are cleared between tests.
const mintedSecret = vi.hoisted(() => vi.spyOn(globalThis.crypto, "randomUUID"));
const secretsMintedOnLoad = mintedSecret.mock.calls.length;

describe("the corrected-path marker", () => {
  /** @scenario "The marker's secret is minted on first use, not on load" */
  it("mints no secret on load, and a path stamped later still reads back as corrected", () => {
    expect(secretsMintedOnLoad).toBe(0);

    const headers = new Headers();
    stampCorrectedPath({ headers, originalPath: "/api/otel/v1/traces/v1/logs" });

    expect(readCorrectedPath(headers.get(OTLP_CORRECTED_PATH_HEADER) ?? void 0)).toBe(
      "/api/otel/v1/traces/v1/logs",
    );
  });
});

describe("canonicalOtlpPath", () => {
  describe("given a base endpoint that already named a signal", () => {
    describe("when the exporter appends its signal path", () => {
      it("maps the appended signal onto its canonical path", () => {
        expect(canonicalOtlpPath("/api/otel/v1/traces/v1/logs")).toBe("/api/otel/v1/logs");
      });
    });

    describe("when the appended signal differs from the base signal", () => {
      it("takes the signal from the suffix", () => {
        expect(canonicalOtlpPath("/api/otel/v1/traces/v1/metrics")).toBe("/api/otel/v1/metrics");
        expect(canonicalOtlpPath("/api/otel/v1/logs/v1/traces")).toBe("/api/otel/v1/traces");
      });
    });
  });

  describe("given a base endpoint that named the collector", () => {
    describe("when the exporter appends a trace path", () => {
      it("maps the collector-prefixed path onto its canonical path", () => {
        expect(canonicalOtlpPath("/api/collector/api/otel/v1/traces")).toBe("/api/otel/v1/traces");
        expect(canonicalOtlpPath("/api/collector/v1/traces")).toBe("/api/otel/v1/traces");
      });
    });
  });

  describe("given a base endpoint that named the site root", () => {
    describe("when the exporter appends a trace path", () => {
      it("maps the root-level signal path onto its canonical path", () => {
        expect(canonicalOtlpPath("/v1/traces")).toBe("/api/otel/v1/traces");
        expect(canonicalOtlpPath("/api/v1/traces")).toBe("/api/otel/v1/traces");
      });
    });
  });

  describe("given a path that is already canonical", () => {
    describe("when it contains no stray slashes", () => {
      it("reports the canonical path it is on", () => {
        expect(canonicalOtlpPath("/api/otel/v1/traces")).toBe("/api/otel/v1/traces");
      });
    });

    describe("when it contains repeated or trailing slashes", () => {
      it("normalises the slashes", () => {
        expect(canonicalOtlpPath("/api/otel/v1/traces/")).toBe("/api/otel/v1/traces");
        expect(canonicalOtlpPath("/api/otel/v1//traces")).toBe("/api/otel/v1/traces");
        expect(
          canonicalOtlpPath(`${"/".repeat(100_000)}api/otel/v1/traces${"/".repeat(100_000)}`),
        ).toBe("/api/otel/v1/traces");
      });
    });
  });

  describe("given a path no supported configuration produces", () => {
    describe("when an unrelated namespace ends in a signal name", () => {
      it("claims nothing", () => {
        expect(canonicalOtlpPath("/api/gateway/v1/traces")).toBeNull();
        expect(canonicalOtlpPath("/api/rum/v1/traces")).toBeNull();
        expect(canonicalOtlpPath("/api/ingest/otel/src_123/v1/traces")).toBeNull();
      });
    });

    describe("when a long uncontrolled prefix contains repeated slashes", () => {
      it("rejects it without changing its namespace", () => {
        const pathname = `a${"/".repeat(200_000)}v1/traces`;

        expect(canonicalOtlpPath(pathname)).toBeNull();
      });
    });

    describe("when the suffix does not name a supported signal", () => {
      it("claims nothing", () => {
        expect(canonicalOtlpPath("/api/otel/v1/traces/v1/profiles")).toBeNull();
        expect(canonicalOtlpPath("/api/otel/v1/traces/v2/traces")).toBeNull();
        expect(canonicalOtlpPath("/api/collector")).toBeNull();
        expect(canonicalOtlpPath("/")).toBeNull();
      });
    });
  });
});
