/**
 * Characterisation of `POST /api/rum/v1/traces` through the real Hono app.
 *
 * The route is thin on purpose, so what is pinned is the wire it publishes:
 * an accepted report answers 202 with NO body, and every refusal the ingest
 * service raises reaches the browser as `{ error, code }` at the status the
 * handled error carries. The 202-with-no-body matters more than it looks — a
 * 5xx here is in the OTLP retryable set, so a shape change turns every open tab
 * into a retry loop against our own app.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { RUM_SESSION_HEADER } from "@langwatch/react-rum/constants";
import { Hono, type ErrorHandler } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRumRestApp, rateLimitKey } from "../rum-rest";
import type { RumRateLimiter } from "../rum-ingest.service";

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
      expect(rateLimitKey(contextWith({ [RUM_SESSION_HEADER]: long }))).toBe(
        `session:${"s".repeat(64)}`,
      );
    });
  });

  describe("when it does not", () => {
    it("names the hop NEAREST us, not the client-supplied first one", () => {
      expect(rateLimitKey(contextWith({ "x-forwarded-for": "1.2.3.4, 9.9.9.9, 10.0.0.1" }))).toBe(
        "ip:10.0.0.1",
      );
      expect(rateLimitKey(contextWith({}))).toBe("ip:unknown");
    });
  });
});

function contextWith(headers: Record<string, string>) {
  return { req: { header: (name: string) => headers[name] } } as never;
}

function mount() {
  const rateLimit: RumRateLimiter = async () => ({ allowed: true });
  const hono = new Hono().route(
    "/",
    createRumRestApp({ security: passThroughSecurity(), rateLimit }),
  );
  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

/** A failure here must be legible rather than swallowed into a generic 500. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A public endpoint must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
