/**
 * @vitest-environment node
 *
 * RBAC gate on /api/langy/chat. The Langy worker carries a service API key
 * with WRITE on traces / evaluations / datasets / scenarios / annotations /
 * analytics / prompts / triggers / workflows. Before #4913 the route gated
 * on `evaluations:view`, so a user with a view-only custom role could ask
 * Langy to create or update any of those resources — a privilege
 * escalation. PR #4913 tightens the gate to require `{resource}:update` on
 * EVERY resource the service key exposes (the `:manage` hierarchy still
 * lets admins through). This file pins the new contract end-to-end.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerAuthSession = vi.fn();
const isEnabled = vi.fn();
const hasProjectPermission = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => isEnabled(...args),
  },
}));
vi.mock("~/server/api/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  return {
    ...actual,
    hasProjectPermission: (...args: unknown[]) =>
      hasProjectPermission(...args),
  };
});

async function postChat(body: unknown) {
  const { app } = await import("../langy");
  return app.request("http://localhost/api/langy/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  projectId: "p1",
  conversationId: null,
  messages: [{ role: "user", parts: [{ text: "hi" }] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.OPENCODE_AGENT_URL = "http://agent.test";
  process.env.LANGY_INTERNAL_SECRET = "secret-for-test";
  // Staff bypass the rollout flag, so the chat-gate test below isolates the
  // RBAC check from the rollout-flag check (one variable per test).
  getServerAuthSession.mockResolvedValue({
    user: { email: "dev@langwatch.ai", id: "u1" },
  });
});

describe("/api/langy/chat RBAC", () => {
  describe("when the caller holds every required Langy permission", () => {
    it("passes the gate (returns past the 403 path)", async () => {
      hasProjectPermission.mockResolvedValue(true);

      const res = await postChat(VALID_BODY);

      // The handler proceeds past the perm gate. It likely 5xx/4xxs later
      // because we mocked nothing downstream — but it must NOT 403 with
      // the "do not have permission" body.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      expect(body.error).not.toBe(
        "You do not have permission to use Langy for this project.",
      );
      // All 9 LANGY_REQUIRED_PERMISSIONS were checked (route loops the
      // full list when each individual check returns true).
      expect(hasProjectPermission).toHaveBeenCalledTimes(9);
    });
  });

  describe("when the caller is missing one Langy write permission", () => {
    it("403s and short-circuits the remaining checks", async () => {
      // First two pass (traces:update, evaluations:update). Then datasets:
      // update returns false → handler must 403 and not query the rest.
      hasProjectPermission
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const res = await postChat(VALID_BODY);
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      expect(res.status).toBe(403);
      expect(body.error).toBe(
        "You do not have permission to use Langy for this project.",
      );
      // Short-circuit: only the three checks before the deny were made.
      // Without this, a deny on a late-listed resource would leak the
      // earlier checks' DB cost on every blocked request.
      expect(hasProjectPermission).toHaveBeenCalledTimes(3);
    });
  });

  describe("when the caller has only the legacy evaluations:view", () => {
    it("403s — the old gate is no longer sufficient", async () => {
      // Simulate a view-only custom role: evaluations:view would pass but
      // any *:update would not. The route requires :update on every
      // resource the service key writes, so the very first check (which
      // requests traces:update, not evaluations:view) denies.
      hasProjectPermission.mockResolvedValue(false);

      const res = await postChat(VALID_BODY);
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      expect(res.status).toBe(403);
      expect(body.error).toBe(
        "You do not have permission to use Langy for this project.",
      );
      expect(hasProjectPermission).toHaveBeenCalledTimes(1);
    });
  });
});
