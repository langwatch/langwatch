/**
 * Characterisation of `POST /api/rum/v1/traces` through the real Hono app the
 * API process mounts.
 */
import { RUM_SESSION_HEADER } from "@langwatch/react-rum/constants";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openTestRestRuntime } from "../../../app-rest/__tests__/support/rest-doors.harness.ts";
import { mountRumRest } from "../rum-rest.mount.ts";
import { rumCallerKey } from "../rum.rest.ts";
import type { RumRateLimiter } from "../rum-ingest.service.ts";

const oneSpan = JSON.stringify({
  resourceSpans: [{ resource: {}, scopeSpans: [{ spans: [{}] }] }],
});

beforeEach(() => {
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector.test:4318";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("given the browser telemetry ingest route", () => {
  describe("when a browser posts a walkable export", () => {
    it("answers 202 with no body", async () => {
      const api = mount();

      const response = await api.fetch("/api/rum/v1/traces", {
        method: "POST",
        body: oneSpan,
      });

      expect(response.status).toBe(202);
      expect(await response.text()).toBe("");
    });
  });

  describe("when the payload cannot be walked", () => {
    it("answers the handled refusal as `{ error, code }` rather than a 500", async () => {
      const api = mount();

      const response = await api.fetch("/api/rum/v1/traces", {
        method: "POST",
        body: '{"resourceSpans":[null]}',
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Malformed payload",
        code: "rum_payload_invalid",
      });
    });
  });

  describe("when no collector is configured", () => {
    it("answers 404 rather than accepting a report nothing will read", async () => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      const api = mount();

      const response = await api.fetch("/api/rum/v1/traces", {
        method: "POST",
        body: oneSpan,
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ code: "rum_ingest_disabled" });
    });
  });
});

describe("given a caller to be named for the rate-limit bucket", () => {
  describe("when the browser sends a session header", () => {
    it("names the session, capped at 64 characters", () => {
      const long = "s".repeat(200);

      expect(rumCallerKey({ session: long, forwardedFor: null })).toBe(
        `session:${"s".repeat(64)}`,
      );
    });
  });

  describe("when it does not", () => {
    it("names the hop NEAREST us, not the client-supplied first one", () => {
      expect(
        rumCallerKey({ session: null, forwardedFor: "1.2.3.4, 9.9.9.9, 10.0.0.1" }),
      ).toBe("ip:10.0.0.1");
      expect(rumCallerKey({ session: null, forwardedFor: null })).toBe("ip:unknown");
    });
  });

  describe("when the browser sends both", () => {
    it("reads the session the door bound from the header the browser writes", async () => {
      const keys: string[] = [];
      const api = mount(async ({ key }) => {
        keys.push(key);

        return { allowed: true };
      });

      await api.fetch("/api/rum/v1/traces", {
        method: "POST",
        body: oneSpan,
        headers: { [RUM_SESSION_HEADER]: "session-1", "x-forwarded-for": "10.0.0.1" },
      });

      expect(keys).toContain("rum:caller:session:session-1");
    });
  });
});

function mount(rateLimit: RumRateLimiter = async () => ({ allowed: true })) {
  const hono = new Hono().route("/", mountRumRest(openTestRestRuntime(), { rateLimit }));

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}
