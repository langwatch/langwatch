/**
 * @vitest-environment node
 *
 * Langy access gate (re-instated for PR #4913). The route is staff-only by
 * default and gated for everyone else by `release_langy_enabled`. These tests
 * pin both halves: staff always bypass the flag, non-staff are 404'd unless
 * the flag resolves true for that user (per-user PostHog/store rule). The 404
 * is intentional — Langy is supposed to look "not present" rather than
 * forbidden so we don't advertise the surface to users who can't use it.
 *
 * The downstream handler still 500s in this env (no DB), which is fine — the
 * gate is what's under test, not the handler.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerAuthSession = vi.fn();
const isEnabled = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => isEnabled(...args),
  },
}));

const GATE_DENIED_MESSAGE = "Langy is not currently enabled for this account.";

async function requestLangy() {
  const { app } = await import("../langy");
  return app.request("http://localhost/api/langy/conversations?projectId=p1", {
    method: "GET",
  });
}

describe("Langy access gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the caller is LangWatch staff", () => {
    it("reaches the handler regardless of the rollout flag", async () => {
      getServerAuthSession.mockResolvedValue({
        user: { email: "dev@langwatch.ai", id: "u1" },
      });
      isEnabled.mockResolvedValue(false);

      const res = await requestLangy();
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      expect(body.error).not.toBe(GATE_DENIED_MESSAGE);
      // Staff bypass short-circuits before the flag is queried — the registry
      // default-off must not be able to lock staff out (debugging lifeline).
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("when the caller is not staff", () => {
    it("404s with the gate message when the rollout flag is OFF", async () => {
      getServerAuthSession.mockResolvedValue({
        user: { email: "user@acme.com", id: "u2" },
      });
      isEnabled.mockResolvedValue(false);

      const res = await requestLangy();
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      expect(res.status).toBe(404);
      expect(body.error).toBe(GATE_DENIED_MESSAGE);
      expect(isEnabled).toHaveBeenCalledWith(
        "release_langy_enabled",
        expect.objectContaining({ distinctId: "u2" }),
      );
    });

    it("reaches the handler when the rollout flag is ON for this user", async () => {
      getServerAuthSession.mockResolvedValue({
        user: { email: "user@acme.com", id: "u3" },
      });
      isEnabled.mockResolvedValue(true);

      const res = await requestLangy();
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      expect(body.error).not.toBe(GATE_DENIED_MESSAGE);
      expect(isEnabled).toHaveBeenCalledWith(
        "release_langy_enabled",
        expect.objectContaining({ distinctId: "u3" }),
      );
    });
  });
});
