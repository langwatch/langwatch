/**
 * The session-authenticated exchange calls are on every command's credential
 * path, so their failure modes are pinned here: a black-holed control plane
 * must time out (so the resolver can fall back to the cached key) and a
 * malformed 200 must fail loudly instead of handing `undefined` to the .env
 * writer.
 *
 * Feature: specs/ai-governance/cli-onboarding/me-credentials.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveConfig = vi.fn();
vi.mock("../config", () => ({
  loadConfig: vi.fn(),
  saveConfig: (...args: unknown[]) => saveConfig(...args),
}));

import {
  fetchPersonalProject,
  fetchProjectKeyBySlug,
  SessionApiError,
} from "../session-api";
import type { GovernanceConfig } from "../config";

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

describe("session-api request bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given a control plane that never answers", () => {
    it("times out instead of hanging the command forever", async () => {
      // A signal-respecting hang: resolves never, rejects on abort. The
      // production wrapper injects AbortSignal.timeout, so the reject path
      // is exactly what a black-holed socket produces.
      const hangingFetch: typeof fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted by the request deadline")),
          );
        });

      await expect(
        fetchPersonalProject(liveSession(), {
          fetchImpl: hangingFetch,
          timeoutMs: 25,
        }),
      ).rejects.toThrow();
    });
  });

  describe("given a 200 project-key response with no api_key", () => {
    it("throws instead of returning a keyless document", async () => {
      const fetchImpl: typeof fetch = async () =>
        jsonResponse(200, {
          project: { id: "p1", slug: "demo", name: "Demo" },
        });

      await expect(
        fetchProjectKeyBySlug(liveSession(), "demo", { fetchImpl }),
      ).rejects.toThrow(SessionApiError);
      await expect(
        fetchProjectKeyBySlug(liveSession(), "demo", { fetchImpl }),
      ).rejects.toMatchObject({ code: "malformed_response" });
    });
  });
});
