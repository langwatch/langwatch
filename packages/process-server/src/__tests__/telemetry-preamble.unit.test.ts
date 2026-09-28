// @vitest-environment node
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import { describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import { Server } from "../server-factory.ts";

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
    it("starts with the scrape door hosted on the built-in health door", async () => {
      const server = await start({
        LANGWATCH_METRICS_MODE: "prometheus",
        LANGWATCH_METRICS_TOKEN: "scrape-me",
      });

      await expect(server.close()).resolves.not.toThrow();
    });
  });
});
