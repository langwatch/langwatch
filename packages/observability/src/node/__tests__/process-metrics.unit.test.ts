// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";

import { metrics } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";

import { counter, resetMetricsForTests } from "../../metrics/index.ts";
import { processMetrics } from "../process-metrics.ts";
import type { TelemetrySecrets, TelemetrySettings } from "../telemetry-settings.ts";

type Contribution = Awaited<ReturnType<ReturnType<typeof processMetrics>>>[number];

const settings = (over: Partial<TelemetrySettings>): TelemetrySettings => ({
  otlpEndpoint: "http://127.0.0.1:1",
  environment: "test",
  serviceVersion: void 0,
  resourceAttributes: void 0,
  tracesSampleRatio: void 0,
  logs: {
    format: void 0,
    level: void 0,
    consoleLevel: void 0,
    otelLevel: void 0,
    otelExport: false,
  },
  metrics: { mode: "otlp", enabled: true },
  ...over,
});

const secretsAnswering = (values: Record<string, string>): TelemetrySecrets => ({
  into: async (handle, build) => build(values[handle.id]),
});

const composeMetrics = (over: Partial<TelemetrySettings>, values: Record<string, string> = {}) =>
  processMetrics("langwatch-test")({
    config: { observability: settings(over) },
    secrets: secretsAnswering(values),
  });

const routeIn = (contributions: readonly Contribution[]) =>
  contributions.find((contribution) => "path" in contribution);

const stopAll = async (contributions: readonly Contribution[]): Promise<void> => {
  for (const contribution of contributions) {
    if ("stop" in contribution) await contribution.stop();
  }
};

let activeServer: http.Server | undefined;

afterEach(async () => {
  if (activeServer !== undefined) {
    await new Promise<void>((resolve) => activeServer?.close(() => resolve()));
    activeServer = void 0;
  }
  metrics.disable();
  resetMetricsForTests();
});

async function scrape(contributions: readonly Contribution[], authorization?: string) {
  const route = routeIn(contributions);
  if (route === undefined || !("handle" in route)) throw new Error("no scrape door was mounted");

  const server = http.createServer((request, response) => void route.handle(request, response));
  activeServer = server;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return fetch(`http://127.0.0.1:${port}/metrics`, {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("the process metrics transport", () => {
  describe("given the default OTLP mode", () => {
    /** @scenario "Metrics push over OTLP" */
    it("pushes, and mounts no scrape door", async () => {
      const contributions = await composeMetrics({ metrics: { mode: "otlp", enabled: true } });

      expect(routeIn(contributions)).toBeUndefined();
      expect(contributions).toHaveLength(1);
      await stopAll(contributions);
    });
  });

  describe("given the Prometheus mode", () => {
    /** @scenario "A scrape reads the process's own instruments" */
    it("mounts a door that serves this process's own instruments", async () => {
      const contributions = await composeMetrics({
        metrics: { mode: "prometheus", enabled: true },
      });
      counter({ name: "langwatch_test_jobs", description: "jobs" }).inc(void 0, 2);

      const response = await scrape(contributions);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("langwatch_test_jobs_total 2");
      await stopAll(contributions);
    });

    /** @scenario "The scrape door is gated by the configured token" */
    it("refuses a scrape that does not carry the configured token", async () => {
      const contributions = await composeMetrics(
        { metrics: { mode: "prometheus", enabled: true } },
        { LANGWATCH_METRICS_TOKEN: "scrape-me" },
      );

      expect((await scrape(contributions)).status).toBe(401);
      await stopAll(contributions);
    });
  });

  describe("given metrics are switched off", () => {
    /** @scenario "Metrics are switched off entirely" */
    it("mounts no door at all", async () => {
      const contributions = await composeMetrics({
        metrics: { mode: "prometheus", enabled: false },
      });

      expect(routeIn(contributions)).toBeUndefined();
      await stopAll(contributions);
    });
  });
});
