// @vitest-environment node
import { createServer, type AddressInfo } from "node:net";

import { processMetrics } from "@langwatch/observability/node";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, describe, expect, it } from "vitest";

import { processConfig } from "../config.ts";
import { Server } from "../preamble.ts";

/** Spec: specs/server/api-process-metrics.feature */
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

/** A process composing prometheus metrics on its own pull port, scraped over HTTP. */
async function serve(environment: Readonly<Record<string, string>>) {
  const port = await freePort();
  const pullPort = await freePort();
  const { logger, lines } = createTestLogger();
  const server = await Server.create("default-collectors-test")
    .withEnvironment({
      OTEL_METRICS_EXPORTER: "otlp,prometheus",
      OTEL_EXPORTER_PROMETHEUS_PORT: String(pullPort),
      ...environment,
    })
    .withConfig(processConfig([], "worker"))
    .withHealthPort(port)
    .withProcessOwnership(false)
    .withSecrets((_, secrets) => secrets.withEnv())
    .withTelemetry(() => ({ logger }))
    .withMetrics(processMetrics("default-collectors-test"))
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
  const scrape = () => fetch(`http://127.0.0.1:${pullPort}/metrics`);
  return { scrape, lines };
}

describe("a process whose registry already carries the default collectors", () => {
  describe("when a second composition installs them again", () => {
    /** @scenario "A registry that already carries default collectors is left intact" */
    it("composes, and a scrape renders each default collector once beside the rest", async () => {
      const first = await serve({});
      const before = await (await first.scrape()).text();
      expect(before).toContain("# TYPE process_cpu_user_seconds_total ");

      const { scrape } = await serve({});

      const response = await scrape();
      expect(response.status).toBe(200);
      const body = await response.text();
      for (const name of ["process_cpu_user_seconds_total", "nodejs_heap_size_total_bytes"]) {
        expect(body.split(`# TYPE ${name} `)).toHaveLength(2);
      }
    });
  });
});

describe("a process in production with no METRICS_API_KEY", () => {
  describe("when it composes", () => {
    /** @scenario "In production an unset key is named at boot" */
    it("mounts no metrics endpoint and names the missing setting in the boot log", async () => {
      const { scrape, lines } = await serve({ NODE_ENV: "production" });

      await expect(scrape()).rejects.toThrow("fetch failed");
      expect(lines.findLine("error", "METRICS_API_KEY")).toBeDefined();
    });
  });
});
