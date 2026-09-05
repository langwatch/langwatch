/**
 * `createApiDualCredentialAuth` arbitrates the two credential kinds a browser-served byte
 * endpoint accepts (files, avatars): a project API key or a live session, never both,
 * never neither, never a fallback from one to the other.
 */
import type { ApiKeyService, ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import {
  ContestedCredentialsError,
  createApiDualCredentialAuth,
  type ApiDualAuthVariables,
} from "../api-dual-credential-auth";
import type { ApiHandlerManagedSessionPort } from "../api-handler-managed-session";

const PROJECT_ID = "project-dual";

function resolvedToken(): ResolvedApiKeyToken {
  return { project: { id: PROJECT_ID } } as ResolvedApiKeyToken;
}

function harness(options: {
  tryResolveToken?: ReturnType<typeof vi.fn>;
  session?: ReturnType<typeof vi.fn>;
}) {
  const tryResolveToken = options.tryResolveToken ?? vi.fn().mockResolvedValue(null);
  const resolve = options.session ?? vi.fn().mockResolvedValue(null);
  const enforceCeiling = vi.fn().mockResolvedValue(undefined);
  const middleware = createApiDualCredentialAuth({
    apiKeys: { tryResolveToken } as unknown as ApiKeyService,
    session: { resolve } as unknown as ApiHandlerManagedSessionPort,
    credentials: { enforceCeiling },
  });

  const app = new Hono<{ Variables: ApiDualAuthVariables }>();
  app.onError((err, c) => {
    if (err instanceof ContestedCredentialsError) {
      return c.json({ error: err.code, meta: err.meta }, err.httpStatus as 401);
    }
    if (err instanceof HTTPException) return err.getResponse();
    throw err;
  });
  app.use("*", middleware);
  const handler = vi.fn((c) =>
    c.json({ userId: c.get("userId") ?? null, apiKeyProjectId: c.get("apiKeyProjectId") ?? null }),
  );
  app.get("/", handler as never);

  return { app, handler, tryResolveToken, resolve };
}

describe("createApiDualCredentialAuth", () => {
  describe("given API key credentials and no session", () => {
    /** @scenario "An API key alone authenticates a byte endpoint" */
    it("authenticates through the key", async () => {
      const { app, resolve } = harness({
        tryResolveToken: vi.fn().mockResolvedValue(resolvedToken()),
      });

      const res = await app.request("/", { headers: { authorization: "Bearer sk-lw-valid" } });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ userId: null, apiKeyProjectId: PROJECT_ID });
      expect(resolve).toHaveBeenCalled();
    });
  });

  describe("given a live session and no API key headers", () => {
    /** @scenario "A session alone authenticates a byte endpoint" */
    it("authenticates as the session's user", async () => {
      const { app, tryResolveToken } = harness({
        session: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
      });

      const res = await app.request("/");

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ userId: "user-1", apiKeyProjectId: null });
      expect(tryResolveToken).not.toHaveBeenCalled();
    });
  });

  describe("given both an API key and a live session", () => {
    /** @scenario "A request carrying both credential kinds is refused" */
    it("refuses as contested without trying either credential", async () => {
      const { app, handler, tryResolveToken } = harness({
        session: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
      });

      const res = await app.request("/", { headers: { authorization: "Bearer sk-lw-valid" } });

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        error: "contested_credentials",
        meta: { kinds: ["api-key", "session"] },
      });
      expect(tryResolveToken).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("given a foreign proxy's Basic header alongside a live session", () => {
    /** @scenario "A non-LangWatch proxy credential abstains so the session decides" */
    it("does not contest — the session authenticates the request", async () => {
      const { app, tryResolveToken } = harness({
        session: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
      });

      const res = await app.request("/", {
        headers: {
          authorization: `Basic ${Buffer.from("proxyuser:proxypass").toString("base64")}`,
        },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ userId: "user-1", apiKeyProjectId: null });
      expect(tryResolveToken).not.toHaveBeenCalled();
    });
  });

  describe("given a legacy prefix-less project key and no session", () => {
    /** @scenario "A legacy prefix-less project key with no session still authenticates" */
    it("claims the request and lets the stored-key lookup decide", async () => {
      const { app } = harness({
        tryResolveToken: vi.fn().mockResolvedValue(resolvedToken()),
      });

      const res = await app.request("/", {
        headers: { authorization: "Bearer test-api-key-legacy" },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ userId: null, apiKeyProjectId: PROJECT_ID });
    });
  });

  describe("given API key credentials that do not resolve", () => {
    /** @scenario "An invalid API key is refused without falling back to the session" */
    it("answers unauthenticated with no fallback", async () => {
      const { app, handler } = harness({ tryResolveToken: vi.fn().mockResolvedValue(null) });

      const res = await app.request("/", { headers: { authorization: "Bearer sk-lw-expired" } });

      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("given neither credential kind", () => {
    /** @scenario "A request with neither credential is refused" */
    it("refuses as unauthenticated", async () => {
      const { app, handler } = harness({});

      const res = await app.request("/");

      expect(res.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
