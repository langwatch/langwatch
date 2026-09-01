import { HandledError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DualAuthVariables } from "../dual-auth";

const getServerAuthSessionMock = vi.hoisted(() => vi.fn());
vi.mock("~/server/auth", () => ({
  getServerAuthSession: getServerAuthSessionMock,
}));

/**
 * The unified auth middleware, stubbed at the seam dualAuth drives it
 * through: on success it populates `c.var.project`; on refusal it answers
 * its own response and leaves the variable unset, exactly like the real one.
 */
const authMiddlewareMock = vi.hoisted(() => vi.fn());
vi.mock("../auth", () => ({ authMiddleware: authMiddlewareMock }));

import { dualAuth } from "../dual-auth";

const PROJECT_ID = "project-dual";

function appWithDualAuth() {
  const handler = vi.fn((c: { json: (body: unknown) => Response }) => {
    const ctx = c as unknown as {
      get: (name: string) => unknown;
      json: (body: unknown) => Response;
    };
    return ctx.json({
      userId: ctx.get("userId") ?? null,
      apiKeyProjectId: ctx.get("apiKeyProjectId") ?? null,
    });
  });
  const app = new Hono<{ Variables: DualAuthVariables }>();
  // Mirror createServiceApp's onError: a thrown HandledError serialises to its
  // code at its httpStatus, which is how the real byte routes answer.
  app.onError((err, c) => {
    if (HandledError.isHandled(err)) {
      return c.json({ error: err.code, meta: err.meta }, err.httpStatus as 401);
    }
    if (err instanceof HTTPException) return err.getResponse();
    throw err;
  });
  app.use("*", dualAuth);
  app.get("/", handler as never);
  return { app, handler };
}

function acceptingAuthMiddleware() {
  authMiddlewareMock.mockImplementation(
    async (c: { set: (name: string, value: unknown) => void }) => {
      c.set("project", { id: PROJECT_ID });
    },
  );
}

function refusingAuthMiddleware() {
  authMiddlewareMock.mockImplementation(
    async (c: {
      json: (body: unknown, status: number) => Response;
    }): Promise<Response> =>
      c.json({ error: "Unauthorized", message: "Invalid credentials" }, 401),
  );
}

beforeEach(() => {
  getServerAuthSessionMock.mockReset();
  getServerAuthSessionMock.mockResolvedValue(null);
  authMiddlewareMock.mockReset();
});

describe("dualAuth", () => {
  describe("given API key credentials and no session", () => {
    /** @scenario "An API key alone authenticates a byte endpoint" */
    it("authenticates through the unified auth middleware", async () => {
      acceptingAuthMiddleware();
      const { app } = appWithDualAuth();

      const res = await app.request("/", {
        headers: { authorization: "Bearer sk-lw-valid" },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        userId: null,
        apiKeyProjectId: PROJECT_ID,
      });
    });
  });

  describe("given a live session and no API key headers", () => {
    /** @scenario "A session alone authenticates a byte endpoint" */
    it("authenticates as the session's user", async () => {
      getServerAuthSessionMock.mockResolvedValue({ user: { id: "user-1" } });
      const { app } = appWithDualAuth();

      const res = await app.request("/");

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        userId: "user-1",
        apiKeyProjectId: null,
      });
      expect(authMiddlewareMock).not.toHaveBeenCalled();
    });
  });

  describe("given both an API key and a live session", () => {
    /** @scenario "A request carrying both credential kinds is refused" */
    it("refuses as contested without trying either credential", async () => {
      getServerAuthSessionMock.mockResolvedValue({ user: { id: "user-1" } });
      const { app, handler } = appWithDualAuth();

      const res = await app.request("/", {
        headers: { authorization: "Bearer sk-lw-valid" },
      });

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        error: "contested_credentials",
        meta: { kinds: ["api-key", "session"] },
      });
      expect(authMiddlewareMock).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("given a foreign proxy's Basic header alongside a live session", () => {
    /** @scenario "A non-LangWatch proxy credential abstains so the session decides" */
    it("does not contest — the session authenticates the request", async () => {
      getServerAuthSessionMock.mockResolvedValue({ user: { id: "user-1" } });
      const { app } = appWithDualAuth();

      // A reverse proxy injects `Authorization: Basic base64("user:pass")`;
      // its token part is not a LangWatch credential, so the api-key claim
      // abstains and the session wins instead of the two contesting.
      const res = await app.request("/", {
        headers: {
          authorization: `Basic ${Buffer.from("proxyuser:proxypass").toString("base64")}`,
        },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        userId: "user-1",
        apiKeyProjectId: null,
      });
      expect(authMiddlewareMock).not.toHaveBeenCalled();
    });
  });

  describe("given a legacy prefix-less project key and no session", () => {
    /** @scenario "A legacy prefix-less project key with no session still authenticates" */
    it("claims the request and lets the stored-key lookup decide", async () => {
      acceptingAuthMiddleware();
      const { app } = appWithDualAuth();

      // A project key minted before the `sk-lw-` prefix existed: no LangWatch
      // prefix, but a stored key the legacy lookup resolves. With no session
      // to defer to, the abstention that protects proxy-fronted media fetches
      // must not apply — refusing here would lock every pre-prefix key out.
      const res = await app.request("/", {
        headers: { authorization: "Bearer test-api-key-legacy" },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        userId: null,
        apiKeyProjectId: PROJECT_ID,
      });
    });
  });

  describe("given API key credentials that do not resolve", () => {
    /** @scenario "An invalid API key is refused without falling back to the session" */
    it("answers the API key's own refusal with no fallback", async () => {
      refusingAuthMiddleware();
      const { app, handler } = appWithDualAuth();

      const res = await app.request("/", {
        headers: { authorization: "Bearer sk-lw-expired" },
      });

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        message: "Invalid credentials",
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("given neither credential kind", () => {
    /** @scenario "A request with neither credential is refused" */
    it("refuses as unauthenticated", async () => {
      const { app, handler } = appWithDualAuth();

      const res = await app.request("/");

      expect(res.status).toBe(401);
      expect(authMiddlewareMock).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
