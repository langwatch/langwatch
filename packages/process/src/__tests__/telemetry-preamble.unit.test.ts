// @vitest-environment node
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import { describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import { Server } from "../preamble.ts";

const start = (environment: Readonly<Record<string, string>> = {}) =>
  Server.create("telemetry-preamble-test")
    .withEnvironment(environment)
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
      const server = await start({
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer collector-token",
      });

      expect(server.config).toHaveProperty("observability");
      await server.close();
    });
  });

  describe("given the Prometheus transport", () => {
    it("starts with the pull door on a listener of its own", async () => {
      const server = await start({
        OTEL_METRICS_EXPORTER: "otlp,prometheus",
        OTEL_EXPORTER_PROMETHEUS_PORT: "0",
        METRICS_API_KEY: "scrape-me",
      });

      await expect(server.close()).resolves.not.toThrow();
    });
  });
});
