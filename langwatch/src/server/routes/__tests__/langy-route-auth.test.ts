/**
 * @vitest-environment node
 *
 * @see specs/assistant/langy-baseline.feature — Access and rollout gating
 *
 * Binds the Langy access contract:
 *   - LangWatch staff always reach Langy, even with the rollout flag OFF.
 *   - Non-staff are blocked unless the rollout flag is on for them.
 *
 * The flag is the lever for opening Langy beyond staff; it can never lock
 * staff out. A future re-introduction of a hard "staff AND flag" gate would
 * fail the staff scenario here.
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

// The 403 the access middleware emits when neither staff nor rollout lets the
// caller through. Pass-through cases assert the answer is NOT this string —
// downstream handler errors (no DB in this env) are fine; only the gate is
// under test here.
const GATE_BLOCKED = "Langy is not currently enabled";

async function requestLangy() {
  const { app } = await import("../langy");
  return app.request(
    "http://localhost/api/langy/conversations?projectId=p1",
    { method: "GET" },
  );
}

describe("Langy access gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the user is LangWatch staff", () => {
    describe("and Langy has not been rolled out beyond staff", () => {
      it("is not blocked by the rollout gate", async () => {
        getServerAuthSession.mockResolvedValue({
          user: { email: "dev@langwatch.ai", id: "u1" },
        });
        isEnabled.mockResolvedValue(false);

        const res = await requestLangy();
        const body = (await res.json().catch(() => ({}))) as { error?: string };

        expect(body.error).not.toBe(GATE_BLOCKED);
        // Staff must never trigger the flag lookup at all.
        expect(isEnabled).not.toHaveBeenCalled();
      });
    });
  });

  describe("when the user is not staff", () => {
    describe("and Langy has not been rolled out to them", () => {
      it("is rejected with a 403", async () => {
        getServerAuthSession.mockResolvedValue({
          user: { email: "user@acme.com", id: "u2" },
        });
        isEnabled.mockResolvedValue(false);

        const res = await requestLangy();

        expect(res.status).toBe(403);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toBe(GATE_BLOCKED);
      });
    });

    describe("and Langy has been rolled out to them", () => {
      it("is not blocked by the rollout gate", async () => {
        getServerAuthSession.mockResolvedValue({
          user: { email: "user@acme.com", id: "u3" },
        });
        isEnabled.mockResolvedValue(true);

        const res = await requestLangy();
        const body = (await res.json().catch(() => ({}))) as { error?: string };

        expect(body.error).not.toBe(GATE_BLOCKED);
      });
    });
  });
});
