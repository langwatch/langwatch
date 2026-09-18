// @vitest-environment node
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { processConfig } from "../config.ts";
import { Server } from "../server-factory.ts";

afterEach(() => vi.unstubAllEnvs());

const start = () =>
  Server.create("telemetry-preamble-test")
    .withConfig(processConfig([], "worker"))
    .withHealthPort(0)
    .withProcessOwnership(false)
    .withSecrets((_, secrets) => secrets.withEnv())
    .withTelemetry(processTelemetry("telemetry-preamble-test"))
    .withMetrics(processMetrics("telemetry-preamble-test"))
    .start();

describe("the preamble's telemetry and metrics slots", () => {
  describe("given the observability owner's own declared slice", () => {
    it("wires traces, logs and metrics from config and the resolved credential", async () => {
      vi.stubEnv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Bearer collector-token");

      const server = await start();

      expect(server.config).toHaveProperty("observability");
      await server.close();
    });
  });

  describe("given the Prometheus transport", () => {
    it("starts with the scrape door hosted on the built-in health door", async () => {
      vi.stubEnv("LANGWATCH_METRICS_MODE", "prometheus");
      vi.stubEnv("LANGWATCH_METRICS_TOKEN", "scrape-me");

      const server = await start();

      await expect(server.close()).resolves.not.toThrow();
    });
  });
});
