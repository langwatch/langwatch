// @vitest-environment node
import { RumApi } from "@langwatch/rum-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rumProcessModule } from "../../rum.module.ts";
import {
  COLLECTOR_ENDPOINT,
  exportWith,
  rumInstallation,
  TELEMETRY_ENDPOINT,
} from "./rum.fixture.ts";

function stubCollector() {
  const collector = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null),
  );
  vi.stubGlobal("fetch", collector);
  return collector;
}

function sentTo(collector: ReturnType<typeof stubCollector>) {
  const [input, init] = collector.mock.calls[0] ?? [];
  return {
    url: typeof input === "string" ? input : undefined,
    headers: new Headers(init?.headers),
  };
}

const report = { body: exportWith(1), session: "s", forwardedFor: undefined };

const deprecationWarnings = (lines: ReturnType<typeof createTestLogger>["lines"]) =>
  lines.filter((line) => line.level === 40 && String(line.msg).includes("deprecated"));

describe("rum app installation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("installs a working ingest over memory buckets", async () => {
    const collector = stubCollector();
    const runtime = await rumInstallation({ collectorEndpoint: COLLECTOR_ENDPOINT }).boot();

    const api = runtime.service(RumApi);
    expect(runtime.module(rumProcessModule).provided).toBe(api);
    await api.ingestBrowserTraces(report);

    await vi.waitFor(() => expect(collector).toHaveBeenCalledOnce());
  });

  describe("given both rum's collector and observability's", () => {
    /** @scenario "rum's own collector variables win over the deprecated ones" */
    it("forwards to rum's collector with rum's headers and warns about nothing", async () => {
      const collector = stubCollector();
      const { logger, lines } = createTestLogger();
      const runtime = await rumInstallation({
        collectorEndpoint: COLLECTOR_ENDPOINT,
        collectorHeaders: "Authorization=Bearer rum",
        telemetryEndpoint: TELEMETRY_ENDPOINT,
        telemetryHeaders: { Authorization: "Bearer otel" },
        logger,
      }).boot();

      await runtime.service(RumApi).ingestBrowserTraces(report);

      await vi.waitFor(() => expect(collector).toHaveBeenCalledOnce());
      expect(sentTo(collector).url).toBe(`${COLLECTOR_ENDPOINT}/v1/traces`);
      expect(sentTo(collector).headers.get("authorization")).toBe("Bearer rum");
      expect(deprecationWarnings(lines)).toEqual([]);
    });
  });

  describe("given only observability's deprecated collector", () => {
    /** @scenario "The deprecated OTLP variables still work and warn once at boot" */
    it("forwards to it with its headers and warns once, naming old and new variables", async () => {
      const collector = stubCollector();
      const { logger, lines } = createTestLogger();
      const runtime = await rumInstallation({
        collectorEndpoint: undefined,
        telemetryEndpoint: TELEMETRY_ENDPOINT,
        telemetryHeaders: { Authorization: "Bearer otel" },
        logger,
      }).boot();

      await runtime.service(RumApi).ingestBrowserTraces(report);
      await runtime.service(RumApi).ingestBrowserTraces(report);

      await vi.waitFor(() => expect(collector).toHaveBeenCalledTimes(2));
      expect(sentTo(collector).url).toBe(`${TELEMETRY_ENDPOINT}/v1/traces`);
      expect(sentTo(collector).headers.get("authorization")).toBe("Bearer otel");
      const warnings = deprecationWarnings(lines);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.deprecated).toEqual([
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_EXPORTER_OTLP_HEADERS",
      ]);
      expect(warnings[0]?.replacements).toEqual([
        "RUM_COLLECTOR_ENDPOINT",
        "RUM_COLLECTOR_HEADERS",
      ]);
    });
  });

  describe("given a deployment that names no collector at all", () => {
    /** @scenario "A report to a deployment with no collector is refused as not configured" */
    it("refuses every report as not configured", async () => {
      const runtime = await rumInstallation({ collectorEndpoint: undefined }).boot();

      await expect(runtime.service(RumApi).ingestBrowserTraces(report)).rejects.toMatchObject({
        code: "rum_ingest_disabled",
        httpStatus: 404,
      });
    });
  });
});
