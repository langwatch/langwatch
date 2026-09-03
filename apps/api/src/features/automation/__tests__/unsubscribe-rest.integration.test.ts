/**
 * Characterisation of `POST /api/unsubscribe` through the real Hono app.
 *
 * The wire here is read by MAIL CLIENTS, not by our own code, so each shape is
 * load-bearing: 200 on a spent token (the client shows success), 400 on one
 * that is missing or tampered with, 405 with `Allow: POST` on any other
 * method — the registration order that produces it is the reason the guard is
 * a second route rather than a branch — and 500, never 400, when the write
 * itself fails, so a database blip is not reported to the recipient as a dead
 * link.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { createUnsubscribeRestApp, type UnsubscribeRestPorts } from "@langwatch/automation-server";
import { InvalidUnsubscribeTokenError } from "@langwatch/automation-contract";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it } from "vitest";

describe("given the one-click unsubscribe door", () => {
  describe("when a mail client posts a valid token", () => {
    it("answers 200 and spends it against the trigger scope", async () => {
      const spent: { token: string; scope: string }[] = [];
      const api = mount({ confirm: async (input) => void spent.push(input) });

      const response = await api.fetch("/api/unsubscribe?token=t_valid", { method: "POST" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(spent).toEqual([{ token: "t_valid", scope: "trigger" }]);
    });
  });

  describe("when the link carries no token", () => {
    it("answers 400 without reaching the application", async () => {
      const spent: { token: string; scope: string }[] = [];
      const api = mount({ confirm: async (input) => void spent.push(input) });

      const response = await api.fetch("/api/unsubscribe", { method: "POST" });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Missing token" });
      expect(spent).toEqual([]);
    });
  });

  describe("when the token is tampered with", () => {
    it("answers 400, distinct from the 500 a write failure gets", async () => {
      const refusing = mount({
        confirm: async () => {
          throw new InvalidUnsubscribeTokenError();
        },
      });
      const broken = mount({
        confirm: async () => {
          throw new Error("connection reset");
        },
      });

      const tampered = await refusing.fetch("/api/unsubscribe?token=t_bad", { method: "POST" });
      expect(tampered.status).toBe(400);
      await expect(tampered.json()).resolves.toEqual({ error: "Invalid token" });

      const failed = await broken.fetch("/api/unsubscribe?token=t_valid", { method: "POST" });
      expect(failed.status).toBe(500);
      await expect(failed.json()).resolves.toEqual({ error: "Internal server error" });
    });
  });

  describe("when the caller has already filled the window", () => {
    it("answers 429 before the token is even read", async () => {
      const spent: { token: string; scope: string }[] = [];
      const api = mount({
        confirm: async (input) => void spent.push(input),
        allowed: false,
      });

      const response = await api.fetch("/api/unsubscribe?token=t_valid", { method: "POST" });

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toEqual({ error: "Too many requests" });
      expect(spent).toEqual([]);
    });
  });

  describe("when the method is anything but POST", () => {
    it("answers 405 with an Allow header rather than a bare 404", async () => {
      const api = mount({ confirm: async () => {} });

      const response = await api.fetch("/api/unsubscribe?token=t_valid", { method: "GET" });

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      await expect(response.json()).resolves.toEqual({ error: "Method not allowed" });
    });
  });
});

function mount(options: {
  confirm: (input: { token: string; scope: string }) => Promise<void>;
  allowed?: boolean;
}) {
  const keys: string[] = [];
  const ports: UnsubscribeRestPorts = {
    automation: () => ({ confirmUnsubscribe: options.confirm }) as never,
    rateLimit: async ({ key }) => {
      keys.push(key);
      return { allowed: options.allowed ?? true };
    },
    clientAddress: () => "10.0.0.1",
  };
  const hono = new Hono().route(
    "/",
    createUnsubscribeRestApp({ security: passThroughSecurity(), ports }),
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
