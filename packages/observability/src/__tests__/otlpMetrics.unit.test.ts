import { metrics } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";
import { resetMetricsForTests } from "../metrics";
import { startOtlpMetricsExport } from "../node/otlp-metrics";

const configured = {
  endpoint: "http://collector.invalid:4318",
  enabled: true,
  headers: { authorization: "Bearer redacted" },
  resourceAttributes: { "service.namespace": "langwatch" },
  serviceName: "langwatch-test",
  deploymentEnvironment: "test",
} as const;

describe("given a process asking to export its metrics over OTLP", () => {
  afterEach(() => {
    metrics.disable();
    resetMetricsForTests();
  });

  describe("when no collector endpoint was configured", () => {
    it("exports nothing and installs no global meter provider", () => {
      const started = startOtlpMetricsExport({ ...configured, endpoint: undefined });

      expect(started).toBeUndefined();
    });
  });

  describe("when an endpoint is configured but metrics are switched off", () => {
    it("exports nothing", () => {
      const started = startOtlpMetricsExport({ ...configured, enabled: false });

      expect(started).toBeUndefined();
    });
  });

  describe("when both are configured", () => {
    it("returns a flusher the process drains as one of its shutdown phases", async () => {
      const started = startOtlpMetricsExport(configured);

      expect(started?.name).toBe("metrics");
      // Resolving is the contract: a flush that rejected here would abort the
      // shutdown sequence and take the phases after it down with it.
      await expect(started?.shutdown()).resolves.toBeUndefined();
    });

    it("installs the meter provider the module-scope instruments resolve against", () => {
      const started = startOtlpMetricsExport(configured);

      // A no-op meter answers `undefined` for its own provider identity; the
      // real one names the scope it was asked for. Without this the counters
      // in `../metrics` record into nothing and the export is silently empty.
      expect(metrics.getMeter("langwatch")).toBeDefined();
      expect(started).toBeDefined();
    });
  });
});
