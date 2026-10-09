// @vitest-environment node
import http from "node:http";
import { createServer, type AddressInfo } from "node:net";

import { metrics } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";

import { counter, observableGauge, resetMetricsForTests } from "../../metrics/index.ts";
import { processMetrics } from "../process-metrics.ts";
import type { TelemetrySecrets, TelemetrySettings } from "../telemetry-settings.ts";

type Contribution = Awaited<ReturnType<ReturnType<typeof processMetrics>>>[number];

const settings = (over: Partial<TelemetrySettings>): TelemetrySettings => ({
  otlpEndpoint: void 0,
  environment: "test",
  serviceVersion: void 0,
  resourceAttributes: void 0,
  serviceName: void 0,
  sdkDisabled: false,
  tracesSampleRatio: void 0,
  traces: { exporter: void 0 },
  logs: {
    format: void 0,
    level: void 0,
    consoleLevel: void 0,
    otelLevel: void 0,
    exporter: "none",
  },
  metrics: { exporter: "otlp" },
  ...over,
});

const secretsAnswering = (values: Record<string, string>): TelemetrySecrets => ({
  into: async (handle, build) => build(values[handle.id]),
});

const live: Contribution[][] = [];
const closers: (() => Promise<void>)[] = [];

async function stopAll(contributions: readonly Contribution[]): Promise<void> {
  for (const contribution of [...contributions].reverse()) {
    if ("stop" in contribution) await contribution.stop();
  }
}

afterEach(async () => {
  while (live.length > 0) await stopAll(live.pop() ?? []);
  while (closers.length > 0) await closers.pop()?.();
  metrics.disable();
  resetMetricsForTests();
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function bootLog() {
  const lines: { level: string; msg: string }[] = [];
  return {
    lines,
    logger: {
      error: (_obj: object, msg: string) => lines.push({ level: "error", msg }),
      warn: (_obj: object, msg: string) => lines.push({ level: "warn", msg }),
    },
  };
}

async function compose({
  over,
  values = {},
  nodeEnvironment,
  logger,
}: {
  over: Partial<TelemetrySettings>;
  values?: Record<string, string>;
  nodeEnvironment?: string;
  logger?: ReturnType<typeof bootLog>["logger"];
}) {
  const contributions = await processMetrics("langwatch-test")({
    config: { observability: settings(over), process: { nodeEnvironment } },
    secrets: secretsAnswering(values),
    ...(logger === undefined ? {} : { logger }),
  });
  live.push([...contributions]);
  return contributions;
}

const routeIn = (contributions: readonly Contribution[]) =>
  contributions.find((contribution) => "path" in contribution);

const listenerIn = (contributions: readonly Contribution[]) =>
  contributions.find((contribution) => "start" in contribution);

/** A pull door on a port of its own: started, then scraped there. */
async function pullDoor({ exporter = "otlp,prometheus", ...rest }: PullOptions = {}) {
  const port = await freePort();
  const contributions = await compose({
    ...rest,
    over: {
      metrics: { exporter, prometheusHost: "127.0.0.1", prometheusPort: port },
      ...rest.over,
    },
  });
  const door = listenerIn(contributions);
  if (door !== undefined && "start" in door) await door.start?.();
  const scrape = (authorization?: string) =>
    fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: authorization === undefined ? {} : { authorization },
    });
  return { contributions, door, scrape };
}

type PullOptions = Partial<Omit<Parameters<typeof compose>[0], "over">> & {
  exporter?: string;
  over?: Partial<TelemetrySettings>;
};

/** A collector that counts the OTLP pushes it receives. */
async function collector() {
  const paths: string[] = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url ?? "");
    request.resume();
    request.on("end", () => response.writeHead(200).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return { endpoint: `http://127.0.0.1:${port}`, paths };
}

describe("the process metrics transport", () => {
  describe("given the default OTLP push", () => {
    /** @scenario "Metrics push over OTLP" */
    it("pushes, and mounts no scrape door", async () => {
      const { endpoint, paths } = await collector();
      const contributions = await compose({
        over: { otlpEndpoint: endpoint, metrics: { exporter: "otlp" } },
      });

      expect(routeIn(contributions)).toBeUndefined();
      expect(listenerIn(contributions)).toBeUndefined();
      expect(contributions).toHaveLength(1);
      await stopAll(live.pop() ?? contributions);
      expect(paths).toContain("/v1/metrics");
    });
  });

  describe("given push and pull together", () => {
    /** @scenario "Push and pull read one provider" */
    it("serves the scrape on its own port and still pushes to the collector", async () => {
      const { endpoint, paths } = await collector();
      const { contributions, scrape } = await pullDoor({ over: { otlpEndpoint: endpoint } });
      counter({ name: "langwatch_test_jobs", description: "jobs" }).inc(void 0, 3);

      const response = await scrape();
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("langwatch_test_jobs_total 3");

      await stopAll(live.pop() ?? contributions);
      expect(paths).toContain("/v1/metrics");
    });
  });

  describe("given the Prometheus exporter outside production", () => {
    /** @scenario "A scrape reads the process's own instruments" */
    it("serves this process's own instruments with no key set", async () => {
      const { scrape } = await pullDoor();
      counter({ name: "langwatch_test_jobs", description: "jobs" }).inc(void 0, 2);

      const response = await scrape();

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("langwatch_test_jobs_total 2");
    });

    /** @scenario "The scrape door is gated by the configured token" */
    it("refuses a scrape with no bearer or the wrong one", async () => {
      const { scrape } = await pullDoor({ values: { METRICS_API_KEY: "scrape-me" } });

      expect((await scrape()).status).toBe(401);
      expect((await scrape("Bearer wrong")).status).toBe(401);
    });
  });

  describe("given the Prometheus exporter in production", () => {
    /** @scenario "In production an unset scrape token mounts no door" */
    it("mounts no door without METRICS_API_KEY, the deleted name opening nothing", async () => {
      const { lines, logger } = bootLog();
      const { door } = await pullDoor({
        values: { LANGWATCH_METRICS_TOKEN: "scrape-me" },
        nodeEnvironment: "production",
        logger,
      });

      expect(door).toBeUndefined();
      expect(lines).toContainEqual({
        level: "error",
        msg: expect.stringContaining("METRICS_API_KEY"),
      });
    });

    /** @scenario "An authenticated scrape in production reads the process's instruments" */
    it("serves a scrape that carries METRICS_API_KEY as its bearer", async () => {
      const { scrape } = await pullDoor({
        values: { METRICS_API_KEY: "scrape-me" },
        nodeEnvironment: "production",
      });
      counter({ name: "langwatch_test_jobs", description: "jobs" }).inc(void 0, 1);

      const response = await scrape("Bearer scrape-me");

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("langwatch_test_jobs_total 1");
    });
  });

  describe("given no exporter list and METRICS_API_KEY set", () => {
    /** @scenario "main's health-door /metrics stays while the key is set" */
    it("keeps the route on the health door and warns that it is deprecated", async () => {
      const { lines, logger } = bootLog();
      const contributions = await compose({
        over: { metrics: { exporter: void 0 } },
        values: { METRICS_API_KEY: "scrape-me" },
        logger,
      });

      expect(routeIn(contributions)).toMatchObject({ path: "/metrics" });
      expect(listenerIn(contributions)).toBeUndefined();
      expect(lines).toContainEqual({
        level: "warn",
        msg: expect.stringContaining("OTEL_METRICS_EXPORTER=otlp,prometheus"),
      });
    });
  });

  describe("given the health-door /metrics would need a key or an unwritten exporter list", () => {
    /** @scenario "Naming the exporter list retires the health-door /metrics" */
    it("mounts no route without the key, nor once the exporter list is written", async () => {
      const unkeyed = await compose({ over: { metrics: { exporter: void 0 } } });
      const named = await compose({
        over: { metrics: { exporter: "otlp" } },
        values: { METRICS_API_KEY: "scrape-me" },
      });

      expect(routeIn(unkeyed)).toBeUndefined();
      expect(routeIn(named)).toBeUndefined();
    });
  });

  describe("given metrics are switched off", () => {
    /** @scenario "Metrics are switched off entirely" */
    it("mounts no door at all", async () => {
      const { door } = await pullDoor({ exporter: "none" });

      expect(door).toBeUndefined();
    });
  });

  describe("given a stopped process is replaced in the same Node process", () => {
    it("never reads a gauge the stopped process declared", async () => {
      let reads = 0;
      observableGauge({ name: "langwatch_test_stale", description: "stale" }, (observer) => {
        reads += 1;
        observer.observe(1);
      });
      const first = await pullDoor();
      await stopAll(live.pop() ?? first.contributions);

      const { scrape } = await pullDoor();
      const response = await scrape();

      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("langwatch_test_stale");
      expect(reads).toBe(0);
    });
  });
});
