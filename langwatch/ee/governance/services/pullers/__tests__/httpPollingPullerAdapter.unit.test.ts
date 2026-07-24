/**
 * Unit coverage for HttpPollingPullerAdapter — exercises:
 *   - validateConfig accepting/rejecting shapes
 *   - happy-path single-page pull (1 mocked HTTP call)
 *   - multi-page pull respecting cursor (3 mocked HTTP calls)
 *   - 4xx fails fast, 5xx retries, all retries exhausted → errorCount=1
 *   - cursor extraction handling missing field
 *   - template substitution for headers + bearer auth injection
 *
 * The integration shape (worker → adapter → trace store) is covered
 * separately. This file documents the adapter's pure-function
 * contract using a stub fetch shimmed via `globalThis.fetch`.
 *
 * Spec: specs/ai-governance/puller-framework/http-polling.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpPollingPullerAdapter } from "../httpPollingPullerAdapter";

const VALID_CONFIG = {
  adapter: "http_polling" as const,
  url: "https://api.example.test/v1/audit-log",
  method: "GET" as const,
  headers: {
    Authorization: "Bearer ${{credentials.token}}",
    "X-Org": "${{ingestionSource.organizationId}}",
  },
  authMode: "header_template" as const,
  credentialRef: "test_creds",
  cursorJsonPath: "$.next_cursor",
  cursorQueryParam: "cursor",
  eventsJsonPath: "$.events",
  schedule: "*/5 * * * *",
  eventMapping: {
    source_event_id: "$.id",
    event_timestamp: "$.created_at",
    actor: "$.user.email",
    action: "$.event_type",
    target: "$.model",
    cost_usd: "$.usage.cost",
    tokens_input: "$.usage.input_tokens",
    tokens_output: "$.usage.output_tokens",
  },
};

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

let capturedCalls: FetchCall[] = [];
let responseQueue: Array<{ status: number; body: unknown }> = [];

beforeEach(() => {
  capturedCalls = [];
  responseQueue = [];
  // Mock undici fetch via the ssrfSafeFetch path. Easiest is to mock
  // the module — adapter imports `~/utils/ssrfProtection`.
  vi.doMock("~/utils/ssrfProtection", () => ({
    ssrfSafeFetch: async (url: string, init?: RequestInit) => {
      capturedCalls.push({ url, init });
      const next = responseQueue.shift();
      if (!next) throw new Error("test bug: no queued response");
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json" },
      });
    },
  }));
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("HttpPollingPullerAdapter", () => {
  describe("validateConfig", () => {
    it("accepts a complete valid config", () => {
      const adapter = new HttpPollingPullerAdapter();
      expect(() => adapter.validateConfig(VALID_CONFIG)).not.toThrow();
    });

    it("rejects a non-URL `url` field at validate time, not runtime", () => {
      const adapter = new HttpPollingPullerAdapter();
      expect(() =>
        adapter.validateConfig({ ...VALID_CONFIG, url: "not-a-url" }),
      ).toThrow();
    });

    it("rejects missing required eventMapping fields", () => {
      const adapter = new HttpPollingPullerAdapter();
      const noTarget = {
        ...VALID_CONFIG,
        eventMapping: { ...VALID_CONFIG.eventMapping, target: "" },
      };
      expect(() => adapter.validateConfig(noTarget)).toThrow();
    });

    it("rejects an unknown adapter discriminator", () => {
      const adapter = new HttpPollingPullerAdapter();
      expect(() =>
        adapter.validateConfig({ ...VALID_CONFIG, adapter: "wrong" }),
      ).toThrow();
    });

    it("defaults method to GET when omitted", () => {
      const adapter = new HttpPollingPullerAdapter();
      const { method: _omit, ...withoutMethod } = VALID_CONFIG;
      const parsed = adapter.validateConfig(withoutMethod);
      expect(parsed.method).toBe("GET");
    });
  });

  describe("runOnce — single page", () => {
    it("returns mapped events with cursor=null when API drains in one call", async () => {
      const { HttpPollingPullerAdapter: AdapterUnderTest } = await import(
        "../httpPollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      responseQueue.push({
        status: 200,
        body: {
          events: [
            {
              id: "evt-1",
              created_at: "2026-05-03T10:00:00Z",
              user: { email: "alice@acme.test" },
              event_type: "completion",
              model: "gpt-5-mini",
              usage: { cost: 0.0023, input_tokens: 50, output_tokens: 12 },
            },
            {
              id: "evt-2",
              created_at: "2026-05-03T10:01:00Z",
              user: { email: "bob@acme.test" },
              event_type: "completion",
              model: "gpt-5-mini",
              usage: { cost: 0.0011, input_tokens: 28, output_tokens: 6 },
            },
          ],
          next_cursor: null,
        },
      });

      const result = await adapter.runOnce(
        { cursor: null, credentials: { token: "secret-xyz" } },
        adapter.validateConfig(VALID_CONFIG),
      );

      expect(result.errorCount).toBe(0);
      expect(result.cursor).toBeNull();
      expect(result.events).toHaveLength(2);
      expect(result.events[0]).toMatchObject({
        source_event_id: "evt-1",
        event_timestamp: "2026-05-03T10:00:00Z",
        actor: "alice@acme.test",
        action: "completion",
        target: "gpt-5-mini",
        cost_usd: 0.0023,
        tokens_input: 50,
        tokens_output: 12,
      });
      expect(result.events[0]!.raw_payload).toContain("evt-1");
    });

    it("substitutes credentials into header templates", async () => {
      const { HttpPollingPullerAdapter: AdapterUnderTest } = await import(
        "../httpPollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      responseQueue.push({
        status: 200,
        body: { events: [], next_cursor: null },
      });
      await adapter.runOnce(
        {
          cursor: null,
          credentials: { token: "secret-xyz" },
          context: { organizationId: "org-acme", ingestionSourceId: "src-1" },
        },
        adapter.validateConfig(VALID_CONFIG),
      );
      const headers = capturedCalls[0]!.init!.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer secret-xyz");
      expect(headers["X-Org"]).toBe("org-acme");
    });
  });

  describe("runOnce — multi-page pagination", () => {
    it("chains calls until next_cursor is null", async () => {
      const { HttpPollingPullerAdapter: AdapterUnderTest } = await import(
        "../httpPollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      responseQueue.push({
        status: 200,
        body: {
          events: Array.from({ length: 3 }, (_, i) => ({
            id: `pg1-${i}`,
            created_at: "2026-05-03T10:00:00Z",
            user: { email: "x@test" },
            event_type: "completion",
            model: "m",
            usage: { cost: 0, input_tokens: 0, output_tokens: 0 },
          })),
          next_cursor: "abc123",
        },
      });
      responseQueue.push({
        status: 200,
        body: {
          events: Array.from({ length: 2 }, (_, i) => ({
            id: `pg2-${i}`,
            created_at: "2026-05-03T10:01:00Z",
            user: { email: "y@test" },
            event_type: "completion",
            model: "m",
            usage: { cost: 0, input_tokens: 0, output_tokens: 0 },
          })),
          next_cursor: null,
        },
      });

      const result = await adapter.runOnce(
        { cursor: null, credentials: { token: "x" } },
        adapter.validateConfig(VALID_CONFIG),
      );

      expect(result.events).toHaveLength(5);
      expect(result.cursor).toBeNull();
      expect(capturedCalls).toHaveLength(2);
      // Second call must include cursor query param
      expect(capturedCalls[1]!.url).toContain("cursor=abc123");
    });

    it("uses absolute next_cursor URL as-is when API returns one (Microsoft Graph pattern)", async () => {
      const { HttpPollingPullerAdapter: AdapterUnderTest } = await import(
        "../httpPollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      const nextLink =
        "https://graph.microsoft.com/v1.0/auditLogs/foo?$skiptoken=ABC";
      responseQueue.push({
        status: 200,
        body: { events: [], next_cursor: nextLink },
      });
      responseQueue.push({
        status: 200,
        body: { events: [], next_cursor: null },
      });

      await adapter.runOnce(
        { cursor: null, credentials: { token: "x" } },
        adapter.validateConfig(VALID_CONFIG),
      );

      expect(capturedCalls[1]!.url).toBe(nextLink);
    });
  });

  describe("error paths", () => {
    it("4xx fails fast — single call, errorCount=1, cursor unchanged", async () => {
      const { HttpPollingPullerAdapter: AdapterUnderTest } = await import(
        "../httpPollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      responseQueue.push({ status: 401, body: { error: "unauthorized" } });

      const result = await adapter.runOnce(
        { cursor: "starting-cursor", credentials: { token: "x" } },
        adapter.validateConfig(VALID_CONFIG),
      );

      expect(result.errorCount).toBe(1);
      expect(result.cursor).toBe("starting-cursor");
      expect(result.events).toHaveLength(0);
      expect(capturedCalls).toHaveLength(1); // no retry on 4xx
    });

    it("5xx retries up to twice; if all fail, errorCount=1 + cursor unchanged", async () => {
      const { HttpPollingPullerAdapter: AdapterUnderTest } = await import(
        "../httpPollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      responseQueue.push({ status: 503, body: { error: "down" } });
      responseQueue.push({ status: 503, body: { error: "down" } });
      responseQueue.push({ status: 503, body: { error: "down" } });

      const result = await adapter.runOnce(
        { cursor: "starting-cursor", credentials: { token: "x" } },
        adapter.validateConfig(VALID_CONFIG),
      );

      expect(result.errorCount).toBe(1);
      expect(result.cursor).toBe("starting-cursor");
      expect(capturedCalls.length).toBeGreaterThanOrEqual(3); // initial + 2 retries
    });
  });

  describe("cursor extraction edge cases", () => {
    it("treats missing next_cursor field as drained (cursor=null)", async () => {
      const { HttpPollingPullerAdapter: AdapterUnderTest } = await import(
        "../httpPollingPullerAdapter"
      );
      const adapter = new AdapterUnderTest();
      responseQueue.push({
        status: 200,
        body: { events: [] }, // next_cursor field absent
      });
      const result = await adapter.runOnce(
        { cursor: null, credentials: { token: "x" } },
        adapter.validateConfig(VALID_CONFIG),
      );
      expect(result.cursor).toBeNull();
    });
  });
});
