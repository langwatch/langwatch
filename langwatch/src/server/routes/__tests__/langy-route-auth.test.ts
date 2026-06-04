/**
 * @vitest-environment node
 *
 * Anti-regression for the Langy access-gate removal (#4558): the route used to
 * gate non-staff behind `release_langy_enabled`, returning 403 with the literal
 * "Langy is not currently enabled" when the flag was off. That gate is gone;
 * Langy ships unconditionally to any authenticated session. These tests pin
 * that contract so a re-introduction of the staff/flag gate would fail loudly.
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

// The 403 string the old access middleware emitted. Must never reappear in any
// response — its presence means the gate has crept back.
const REMOVED_GATE_MESSAGE = "Langy is not currently enabled";

async function requestLangy() {
  const { app } = await import("../langy");
  return app.request(
    "http://localhost/api/langy/conversations?projectId=p1",
    { method: "GET" },
  );
}

describe("Langy access (post-#4558: no staff or rollout gate)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the user is LangWatch staff", () => {
    it("reaches the handler regardless of the rollout flag", async () => {
      getServerAuthSession.mockResolvedValue({
        user: { email: "dev@langwatch.ai", id: "u1" },
      });
      isEnabled.mockResolvedValue(false);

      const res = await requestLangy();
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      expect(body.error).not.toBe(REMOVED_GATE_MESSAGE);
      // The removed gate is the only thing that ever called isEnabled here.
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("when the user is not staff", () => {
    it("reaches the handler with the rollout flag OFF", async () => {
      getServerAuthSession.mockResolvedValue({
        user: { email: "user@acme.com", id: "u2" },
      });
      isEnabled.mockResolvedValue(false);

      const res = await requestLangy();
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      expect(body.error).not.toBe(REMOVED_GATE_MESSAGE);
      expect(isEnabled).not.toHaveBeenCalled();
    });

    it("reaches the handler with the rollout flag ON", async () => {
      getServerAuthSession.mockResolvedValue({
        user: { email: "user@acme.com", id: "u3" },
      });
      isEnabled.mockResolvedValue(true);

      const res = await requestLangy();
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      expect(body.error).not.toBe(REMOVED_GATE_MESSAGE);
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });
});
