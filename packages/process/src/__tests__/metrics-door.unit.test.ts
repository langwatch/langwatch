// @vitest-environment node
import { createServer, type AddressInfo } from "node:net";

import { counter } from "@langwatch/observability/metrics";
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import { afterEach, describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import { Server } from "../server-factory.ts";

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

/** A process on its own health door, scraped over HTTP the way a kubelet or Prometheus does. */
async function serve(environment: Readonly<Record<string, string>>) {
  const port = await freePort();
  const server = await Server.create("metrics-door-test")
    .withEnvironment(environment)
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
  return (path: string, authorization?: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      headers: authorization === undefined ? {} : { authorization },
    });
}

const prometheus = { LANGWATCH_METRICS_MODE: "prometheus" };

describe("a process scraped through its health door", () => {
  describe("given a metrics key is configured", () => {
    const keyed = { ...prometheus, LANGWATCH_METRICS_TOKEN: "scrape-me" };

    /** @scenario "Key configured, probe still sends nothing" */
    it("answers the liveness probe with no credential", async () => {
      const request = await serve(keyed);

      expect((await request("/healthz")).status).toBe(200);
    });

    /**
     * @scenario "Metrics still require the bearer when a key is set"
     * @scenario "A scrape with no credential or the wrong one is rejected"
     */
    it("rejects a scrape with no credential or the wrong one, returning no samples", async () => {
      const request = await serve(keyed);

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
      const request = await serve(keyed);
      counter({ name: "scenario_probe_total", description: "Recorded by the scrape test" }).inc({});

      const response = await request("/metrics", "Bearer scrape-me");

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain("scenario_probe_total");
    });
  });

  describe("given no metrics key and a production environment", () => {
    it("mounts no metrics endpoint rather than an open one", async () => {
      const request = await serve({ ...prometheus, NODE_ENV: "production" });

      expect((await request("/metrics")).status).toBe(404);
      expect((await request("/healthz")).status).toBe(200);
    });
  });

  describe("given no metrics key outside production", () => {
    /** @scenario "Outside production an unset key leaves the endpoint open" */
    it("serves a scrape that carries no credential", async () => {
      const request = await serve(prometheus);

      expect((await request("/metrics")).status).toBe(200);
    });
  });
});
