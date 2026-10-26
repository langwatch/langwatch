/** @see modules/auth/specs/request-credential-census.feature */
import { context, propagation, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CENSUS_SPAN_ATTRIBUTES,
  CredentialCensus,
  censusClientOf,
  credentialSpanAttributes,
  noteRequestCredential,
  notedRequestCredential,
  runWithCredentialSlot,
  type CensusRequest,
} from "../request/credentialCensus.ts";

function inMemoryLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger = pino(
    { level: "info" },
    { write: (chunk: string) => lines.push(JSON.parse(chunk) as Record<string, unknown>) },
  );
  return { logger, lines };
}

function censusAt(start = 1_000_000) {
  const clock = { now: start };
  const { logger, lines } = inMemoryLogger();
  const census = CredentialCensus.create({ logger, now: () => clock.now, maxWindows: 3 });
  return { census, lines, clock };
}

const request = (over: Partial<CensusRequest> = {}): CensusRequest => ({
  credentialType: "legacy_project_key",
  projectId: "project-1",
  organizationId: "organization-1",
  method: "GET",
  route: "/api/prompts/:id",
  client: "sdk-python",
  sdkName: "langwatch-observability-sdk",
  sdkVersion: "0.9.0",
  status: 200,
  ...over,
});

const headersOf =
  (headers: Record<string, string>) =>
  (name: string): string | undefined =>
    headers[name];

describe("CredentialCensus", () => {
  describe("given the same key, route and client five times within a minute", () => {
    /** @scenario "Repeated requests within a minute are written as one line with their count" */
    it("writes one line with count 5 once the minute ends, and opens a new one after", () => {
      const { census, lines, clock } = censusAt();
      for (let call = 0; call < 5; call++) {
        census.record(request({ status: call === 4 ? 401 : 200 }));
        clock.now += 1_000;
      }
      census.sweep();
      expect(lines).toHaveLength(0);

      clock.now += 60_000;
      census.sweep();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        msg: "API credential census",
        credentialType: "legacy_project_key",
        projectId: "project-1",
        route: "/api/prompts/:id",
        client: "sdk-python",
        count: 5,
        failedCount: 1,
        status: 401,
      });

      census.record(request());
      census.flush();
      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatchObject({ count: 1 });
    });

    it("keeps separate lines per client and per route", () => {
      const { census, lines } = censusAt();
      census.record(request());
      census.record(request({ client: "cli" }));
      census.record(request({ route: "/api/traces" }));
      census.flush();

      expect(lines.map((line) => line.count)).toEqual([1, 1, 1]);
    });
  });

  describe("given the census is holding its most windows", () => {
    /** @scenario "The census holds a bounded number of windows" */
    it("writes the oldest window early when one more opens", () => {
      const { census, lines } = censusAt();
      census.record(request({ projectId: "a" }));
      census.record(request({ projectId: "a" }));
      census.record(request({ projectId: "b" }));
      census.record(request({ projectId: "c" }));
      expect(lines).toHaveLength(0);

      census.record(request({ projectId: "d" }));

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ projectId: "a", count: 2 });
    });
  });

  describe("when a request with a token and a query string is counted", () => {
    /** @scenario "The census line never carries the token or the query string" */
    it("writes the route template, and neither the token nor the query", () => {
      const { census, lines } = censusAt();
      const token = "sk-lw-secret-legacy-token";
      const client = censusClientOf(
        headersOf({ authorization: `Bearer ${token}`, "user-agent": "curl/8.0" }),
      );
      census.record(request({ ...client, route: "/api/traces/:traceId" }));
      census.flush();

      const written = JSON.stringify(lines);
      expect(lines[0]).toMatchObject({ route: "/api/traces/:traceId", client: "other" });
      expect(written).not.toContain(token);
      expect(written).not.toContain("?");
    });
  });
});

describe("censusClientOf()", () => {
  const typescriptSdk = {
    "user-agent": "langwatch-sdk-node/3.1.0",
    "x-langwatch-sdk-name": "langwatch-observability-sdk",
    "x-langwatch-sdk-language": "typescript",
    "x-langwatch-sdk-version": "3.1.0",
  };
  const mcp = {
    "user-agent": "langwatch-mcp/2.2.0",
    "x-langwatch-sdk-name": "langwatch-mcp",
    "x-langwatch-sdk-language": "typescript",
    "x-langwatch-sdk-version": "2.2.0",
  };
  const cases: [string, Record<string, string>, string][] = [
    [
      "the Python SDK headers",
      {
        "x-langwatch-sdk-name": "langwatch-observability-sdk",
        "x-langwatch-sdk-language": "python",
        "x-langwatch-sdk-version": "0.9.0",
      },
      "sdk-python",
    ],
    ["the TypeScript SDK headers", typescriptSdk, "sdk-typescript"],
    [
      "the Go SDK headers",
      { "x-langwatch-sdk-name": "langwatch-sdk-go", "x-langwatch-sdk-language": "go" },
      "sdk-go",
    ],
    ["a Python SDK user agent alone", { "user-agent": "langwatch-sdk-python/0.9" }, "sdk-python"],
    ["the CLI surface header", { ...typescriptSdk, "x-langwatch-surface": "cli" }, "cli"],
    ["a CLI user agent", { "user-agent": "langwatch-cli/1.0" }, "cli"],
    ["the MCP headers", mcp, "mcp"],
    ["the hosted MCP header", { ...mcp, "x-langwatch-mcp-host": "hosted" }, "hosted-mcp"],
    ["an OTel exporter", { "user-agent": "OTel-OTLP-Exporter-Python/1.0" }, "otel-exporter"],
    ["a browser", { "user-agent": "Mozilla/5.0" }, "browser"],
    ["curl", { "user-agent": "curl/8.0" }, "other"],
  ];

  /** @scenario "Clients are told apart by their identity headers and user agent" */
  it.each(cases)("names %s", (_label, headers, client) => {
    expect(censusClientOf(headersOf(headers)).client).toBe(client);
  });

  it("carries the SDK name and version, and cuts the user agent at 120 characters", () => {
    expect(censusClientOf(headersOf({ ...typescriptSdk, "user-agent": "x".repeat(300) }))).toEqual({
      client: "sdk-typescript",
      sdkName: "langwatch-observability-sdk",
      sdkLanguage: "typescript",
      sdkVersion: "3.1.0",
      userAgent: "x".repeat(120),
    });
  });
});

describe("noteRequestCredential()", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

  beforeAll(() => {
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  describe("when two credentials are noted for one request", () => {
    it("keeps the first and tags the span with it", () => {
      const tracer = trace.getTracer("test");
      const noted = tracer.startActiveSpan("request", (span) => {
        const kept = runWithCredentialSlot((slot) => {
          noteRequestCredential({ credentialType: "api_key", apiKeyId: "key-1", projectId: "p" });
          noteRequestCredential({ credentialType: "legacy_project_key", projectId: "q" });
          return { slot: slot.credential, read: notedRequestCredential() };
        });
        span.end();
        return kept;
      });

      expect(noted.slot).toEqual({ credentialType: "api_key", apiKeyId: "key-1", projectId: "p" });
      expect(noted.read).toBe(noted.slot);
      const [span] = exporter.getFinishedSpans();
      expect(span?.attributes).toMatchObject({
        [CENSUS_SPAN_ATTRIBUTES.credentialType]: "api_key",
        [CENSUS_SPAN_ATTRIBUTES.apiKeyId]: "key-1",
        [CENSUS_SPAN_ATTRIBUTES.projectId]: "p",
      });
    });
  });

  describe("given no request in progress", () => {
    it("notes nothing", () => {
      noteRequestCredential({ credentialType: "session" });

      expect(notedRequestCredential()).toBeUndefined();
      expect(trace.getActiveSpan()).toBeUndefined();
    });
  });

  it("names the client on the span attributes when it is known", () => {
    expect(
      credentialSpanAttributes(
        { credentialType: "session", organizationId: "o" },
        { client: "browser", sdkName: "n", sdkVersion: "1" },
      ),
    ).toEqual({
      [CENSUS_SPAN_ATTRIBUTES.credentialType]: "session",
      [CENSUS_SPAN_ATTRIBUTES.organizationId]: "o",
      [CENSUS_SPAN_ATTRIBUTES.client]: "browser",
      [CENSUS_SPAN_ATTRIBUTES.sdkName]: "n",
      [CENSUS_SPAN_ATTRIBUTES.sdkVersion]: "1",
    });
  });
});
