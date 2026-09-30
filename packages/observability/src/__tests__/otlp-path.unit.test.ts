import { describe, expect, it } from "vitest";
import { canonicalOtlpPath } from "../request/otlp-path";

describe("canonicalOtlpPath", () => {
  describe("given a base endpoint that already named a signal", () => {
    describe("when the exporter appends its signal path", () => {
      it("maps the appended signal onto its canonical path", () => {
        expect(canonicalOtlpPath("/api/otel/v1/traces/v1/logs")).toBe(
          "/api/otel/v1/logs",
        );
      });
    });

    describe("when the appended signal differs from the base signal", () => {
      it("takes the signal from the suffix", () => {
        expect(canonicalOtlpPath("/api/otel/v1/traces/v1/metrics")).toBe(
          "/api/otel/v1/metrics",
        );
        expect(canonicalOtlpPath("/api/otel/v1/logs/v1/traces")).toBe(
          "/api/otel/v1/traces",
        );
      });
    });
  });

  describe("given a base endpoint that named the collector", () => {
    describe("when the exporter appends a trace path", () => {
      it("maps the collector-prefixed path onto its canonical path", () => {
        expect(canonicalOtlpPath("/api/collector/api/otel/v1/traces")).toBe(
          "/api/otel/v1/traces",
        );
        expect(canonicalOtlpPath("/api/collector/v1/traces")).toBe(
          "/api/otel/v1/traces",
        );
      });
    });
  });

  describe("given a base endpoint that named the site root", () => {
    describe("when the exporter appends a trace path", () => {
      it("maps the root-level signal path onto its canonical path", () => {
        expect(canonicalOtlpPath("/v1/traces")).toBe("/api/otel/v1/traces");
        expect(canonicalOtlpPath("/api/v1/traces")).toBe(
          "/api/otel/v1/traces",
        );
      });
    });
  });

  describe("given a path that is already canonical", () => {
    describe("when it contains no stray slashes", () => {
      it("reports the canonical path it is on", () => {
        expect(canonicalOtlpPath("/api/otel/v1/traces")).toBe(
          "/api/otel/v1/traces",
        );
      });
    });

    describe("when it contains repeated or trailing slashes", () => {
      it("normalises the slashes", () => {
        expect(canonicalOtlpPath("/api/otel/v1/traces/")).toBe(
          "/api/otel/v1/traces",
        );
        expect(canonicalOtlpPath("/api/otel/v1//traces")).toBe(
          "/api/otel/v1/traces",
        );
        expect(
          canonicalOtlpPath(
            `${"/".repeat(100_000)}api/otel/v1/traces${"/".repeat(100_000)}`,
          ),
        ).toBe("/api/otel/v1/traces");
      });
    });
  });

  describe("given a path no supported configuration produces", () => {
    describe("when an unrelated namespace ends in a signal name", () => {
      it("claims nothing", () => {
        expect(canonicalOtlpPath("/api/gateway/v1/traces")).toBeNull();
        expect(canonicalOtlpPath("/api/rum/v1/traces")).toBeNull();
        expect(
          canonicalOtlpPath("/api/ingest/otel/src_123/v1/traces"),
        ).toBeNull();
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
        expect(
          canonicalOtlpPath("/api/otel/v1/traces/v1/profiles"),
        ).toBeNull();
        expect(
          canonicalOtlpPath("/api/otel/v1/traces/v2/traces"),
        ).toBeNull();
        expect(canonicalOtlpPath("/api/collector")).toBeNull();
        expect(canonicalOtlpPath("/")).toBeNull();
      });
    });
  });
});
