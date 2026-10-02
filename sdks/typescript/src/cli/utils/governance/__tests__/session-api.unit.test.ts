/**
 * Tests session-authenticated exchange calls: timeouts and malformed responses.
 * Feature: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveConfig = vi.fn();
vi.mock("../config", () => ({
  loadConfig: vi.fn(),
  saveConfig: (...args: unknown[]) => saveConfig(...args),
}));

import { loadConfig } from "../config";
import type { GovernanceConfig } from "../config";
import { fetchPersonalProject, mintProjectFullAccessKey, mintProjectIngestionKey } from "../session-api";

const liveSession = (): GovernanceConfig =>
  ({
    control_plane_url: "https://app.langwatch.ai",
    gateway_url: "https://gateway.langwatch.ai",
    access_token: "lw_at_test",
    refresh_token: "lw_rt_test",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }) as GovernanceConfig;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("session-api request bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given a sibling CLI process already spent the refresh token", () => {
    it("uses the token the sibling persisted instead of logging the user out", async () => {
      // Rotation is single-use server-side, so the token this process holds is
      // refused while the pair the sibling wrote to disk is perfectly live.
      // Reading that as a revocation would delete a working session, and with
      // it the cached personal project.
      const cfg = {
        ...liveSession(),
        access_token: "lw_at_stale",
        refresh_token: "lw_rt_spent",
        expires_at: 1,
        personal_project: { id: "p_1", slug: "acme", name: "ACME" },
      } as GovernanceConfig;
      vi.mocked(loadConfig).mockReturnValue({
        ...cfg,
        refresh_token: "lw_rt_from_sibling",
      } as GovernanceConfig);

      const seen: string[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = requestUrl(input);
        if (url.endsWith("/api/auth/cli/refresh")) {
          const sent = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
            refresh_token?: string;
          };
          seen.push(sent.refresh_token ?? "");
          if (sent.refresh_token === "lw_rt_spent") {
            return jsonResponse(401, { error: "unauthorized" });
          }
          return jsonResponse(200, {
            access_token: "lw_at_fresh",
            refresh_token: "lw_rt_fresh",
            expires_in: 3600,
          });
        }
        return jsonResponse(200, {
          project: { id: "p_1", slug: "acme", name: "ACME", api_key: "sk-lw-1" },
        });
      };

      const project = await fetchPersonalProject(cfg, { fetchImpl });

      expect(seen).toEqual(["lw_rt_spent", "lw_rt_from_sibling"]);
      expect(project?.api_key).toBe("sk-lw-1");
      // The session survived, so nothing was cleared.
      expect(cfg.access_token).toBe("lw_at_fresh");
      expect(cfg.personal_project).toBeDefined();
    });
  });

  describe("given a control plane that never answers", () => {
    it("times out instead of hanging the command forever", async () => {
      // A signal-respecting hang: resolves never, rejects on abort. The
      // production wrapper injects AbortSignal.timeout, so the reject path
      // is exactly what a black-holed socket produces.
      const deadlineFailure = new Error("aborted by the request deadline");
      const hangingFetch: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(deadlineFailure));
        });

      await expect(
        fetchPersonalProject(liveSession(), {
          fetchImpl: hangingFetch,
          timeoutMs: 25,
        }),
      ).rejects.toBe(deadlineFailure);
    });
  });

  describe("given a personal-project answer that carries no key", () => {
    it("returns the project, since the login key authenticates now", async () => {
      const fetchImpl: typeof fetch = async () =>
        jsonResponse(200, { project: { id: "p1", slug: "demo", name: "Demo" } });

      await expect(fetchPersonalProject(liveSession(), { fetchImpl })).resolves.toEqual({
        id: "p1",
        slug: "demo",
        name: "Demo",
      });
    });
  });

  describe("given a project login by slug", () => {
    function controlPlane(refreshAnswer: Record<string, unknown>) {
      const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = requestUrl(input);
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
          string,
          unknown
        >;
        calls.push({ url, body, auth: new Headers(init?.headers).get("authorization") });
        if (url.endsWith("/api/auth/cli/refresh")) return jsonResponse(200, refreshAnswer);
        if (url.endsWith("/api/v1/api-keys/ingestion")) {
          return jsonResponse(201, { token: "sk-lw-ingest", apiKey: { id: "k1", name: "n" } });
        }
        return jsonResponse(200, { ok: true });
      };
      return { calls, fetchImpl };
    }

    it("forks a child session, mints the ingestion key with it, ends the child and keeps the parent", async () => {
      const { calls, fetchImpl } = controlPlane({
        access_token: "lw_at_child",
        refresh_token: "lw_rt_child",
        expires_in: 3600,
        project: { id: "p1", slug: "demo", name: "Demo" },
      });
      const cfg = liveSession();

      const minted = await mintProjectIngestionKey(cfg, "demo", { fetchImpl });

      expect(minted).toEqual({
        api_key: "sk-lw-ingest",
        project: { id: "p1", slug: "demo", name: "Demo" },
      });
      expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
        "/api/auth/cli/refresh",
        "/api/v1/api-keys/ingestion",
        "/api/auth/cli/logout",
      ]);
      expect(calls[0]?.body).toEqual({ refresh_token: "lw_rt_test", project_slug: "demo" });
      expect(calls[1]?.auth).toBe("Bearer lw_at_child");
      expect(calls[1]?.body).toMatchObject({
        keyType: "personal",
        permissionMode: "restricted",
        permissions: ["traces:create"],
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "p1" }],
      });
      expect(calls[2]?.body).toEqual({ refresh_token: "lw_rt_child", access_token: "lw_at_child" });
      expect(cfg.refresh_token).toBe("lw_rt_test");
      expect(saveConfig).not.toHaveBeenCalled();
    });

    it("keeps the pair an older server rotated, and mints nothing", async () => {
      const { calls, fetchImpl } = controlPlane({
        access_token: "lw_at_rotated",
        refresh_token: "lw_rt_rotated",
        expires_in: 3600,
      });
      const cfg = liveSession();

      await expect(mintProjectIngestionKey(cfg, "demo", { fetchImpl })).rejects.toMatchObject({
        code: "endpoint_missing",
      });
      expect(calls).toHaveLength(1);
      expect(cfg.refresh_token).toBe("lw_rt_rotated");
      expect(saveConfig).toHaveBeenCalled();
    });
  });
});

describe("mintProjectFullAccessKey", () => {
  const CHILD = {
    access_token: "lw_at_child",
    refresh_token: "lw_rt_child",
    expires_in: 3600,
    project: { id: "p1", slug: "demo", name: "Demo" },
  };

  function controlPlane({ fullAccessStatus }: { fullAccessStatus: number }) {
    const calls: { path: string; body: Record<string, unknown>; auth: string | null }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = new URL(requestUrl(input)).pathname;
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >;
      calls.push({ path, body, auth: new Headers(init?.headers).get("authorization") });
      if (path === "/api/auth/cli/refresh") return jsonResponse(200, CHILD);
      if (path === "/api/v1/api-keys/full-access") {
        return fullAccessStatus === 201
          ? jsonResponse(201, { token: "sk-lw-project", apiKey: { id: "k1", name: "n" } })
          : jsonResponse(fullAccessStatus, { error: "forbidden" });
      }
      if (path === "/api/v1/api-keys/ingestion") {
        return jsonResponse(201, { token: "sk-lw-ingest", apiKey: { id: "k2", name: "n" } });
      }
      return jsonResponse(200, { ok: true });
    };
    return { calls, fetchImpl };
  }

  /** @scenario `langwatch login --project <slug>` writes a full-access key */
  it("mints the person's own key with every permission on the project, then ends the child", async () => {
    const { calls, fetchImpl } = controlPlane({ fullAccessStatus: 201 });
    const cfg = liveSession();

    const minted = await mintProjectFullAccessKey(cfg, "demo", { fetchImpl });

    expect(minted).toEqual({
      api_key: "sk-lw-project",
      kind: "full-access",
      project: { id: "p1", slug: "demo", name: "Demo" },
    });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/auth/cli/refresh",
      "/api/v1/api-keys/full-access",
      "/api/auth/cli/logout",
    ]);
    expect(calls[1]?.auth).toBe("Bearer lw_at_child");
    expect(calls[1]?.body).toMatchObject({
      keyType: "personal",
      permissionMode: "all",
      bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: "p1" }],
    });
    expect(calls[1]?.body).not.toHaveProperty("permissions");
    expect(calls[2]?.body).toEqual({ refresh_token: "lw_rt_child", access_token: "lw_at_child" });
    expect(cfg.refresh_token).toBe("lw_rt_test");
  });

  /** @scenario A person who cannot manage the project gets an ingestion key and is told so */
  it("falls back to the ingestion key when the full key is refused", async () => {
    const { calls, fetchImpl } = controlPlane({ fullAccessStatus: 403 });

    const minted = await mintProjectFullAccessKey(liveSession(), "demo", { fetchImpl });

    expect(minted).toEqual({
      api_key: "sk-lw-ingest",
      kind: "ingestion",
      project: { id: "p1", slug: "demo", name: "Demo" },
    });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/auth/cli/refresh",
      "/api/v1/api-keys/full-access",
      "/api/v1/api-keys/ingestion",
      "/api/auth/cli/logout",
    ]);
    expect(calls[2]?.auth).toBe("Bearer lw_at_child");
  });
});
