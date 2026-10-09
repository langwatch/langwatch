// @vitest-environment node
import { createServer, type AddressInfo } from "node:net";

import { counter } from "@langwatch/observability/metrics";
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import { afterEach, describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import { Server } from "../preamble.ts";

const servers: { close(): Promise<void> }[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** A process with its health door and pull port, scraped as a kubelet or Prometheus does. */
async function serve(environment: Readonly<Record<string, string>>) {
  const port = await freePort();
  const pullPort = await freePort();
  const server = await Server.create("metrics-door-test")
    .withEnvironment({ OTEL_EXPORTER_PROMETHEUS_PORT: String(pullPort), ...environment })
    .withConfig(processConfig([], "worker"))
    .withHealthPort(port)
    .withProcessOwnership(false)
    .withSecrets((_, secrets) => secrets.withEnv())
    .withTelemetry(processTelemetry("metrics-door-test"))
    .withMetrics(processMetrics("metrics-door-test"))
    .start();
  servers.push(server);
  await server.serve({
    name: "probe",
    start: () => undefined,
    stop: () => undefined,
    handler: (_request: unknown, response: { writeHead(status: number): { end(): void } }) => {
      response.writeHead(404).end();
    },
  });
  const at = (doorPort: number) => (path: string, authorization?: string) =>
    fetch(`http://127.0.0.1:${doorPort}${path}`, {
      headers: authorization === undefined ? {} : { authorization },
    });
  return { health: at(port), pull: at(pullPort) };
}

const prometheus = { OTEL_METRICS_EXPORTER: "otlp,prometheus" };

describe("a process scraped through its health door or its pull port", () => {
  describe("given METRICS_API_KEY and no exporter list (main's health-door /metrics)", () => {
    const keyed = { METRICS_API_KEY: "scrape-me" };

    /** @scenario "Key configured, probe still sends nothing" */
    it("answers the liveness probe with no credential", async () => {
      const { health: request } = await serve(keyed);

      expect((await request("/healthz")).status).toBe(200);
    });

    /**
     * @scenario "Metrics still require the bearer when a key is set"
     * @scenario "A scrape with no credential or the wrong one is rejected"
     */
    it("rejects a scrape with no credential or the wrong one, returning no samples", async () => {
      const { health: request } = await serve(keyed);

      for (const authorization of [undefined, "Bearer wrong"]) {
        const response = await request("/metrics", authorization);
        expect(response.status).toBe(401);
        await expect(response.text()).resolves.not.toContain("scenario_probe_total");
      }
    });

    /**
     * @scenario "Metrics are served to a correctly authenticated caller"
     * @scenario "An authenticated scrape renders what this process recorded"
     */
    it("serves the samples the process recorded to the matching bearer", async () => {
      const { health: request } = await serve(keyed);
      counter({ name: "scenario_probe_total", description: "Recorded by the scrape test" }).inc({});

      const response = await request("/metrics", "Bearer scrape-me");

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain("scenario_probe_total");
    });
  });

  describe("given no metrics key and a production environment", () => {
    /** @scenario "In production an unset key leaves the process with no metrics endpoint" */
    it("mounts no metrics endpoint rather than an open one", async () => {
      const { health, pull } = await serve({ ...prometheus, NODE_ENV: "production" });

      await expect(pull("/metrics")).rejects.toThrow("fetch failed");
      expect((await health("/metrics")).status).toBe(404);
      expect((await health("/healthz")).status).toBe(200);
    });
  });

  describe("given no metrics key outside production", () => {
    /** @scenario "Outside production an unset key leaves the endpoint open" */
    it("serves a scrape that carries no credential", async () => {
      const { pull } = await serve(prometheus);

      expect((await pull("/metrics")).status).toBe(200);
    });
  });
});
