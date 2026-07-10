/**
 * @vitest-environment node
 *
 * Coarse RBAC gate on /api/langy/chat.
 *
 * Under ADR-043 the fine-grained authorisation is the per-session API key
 * minted in getOrProvision — scoped to exactly the permissions the CALLER
 * holds, so a Langy tool call can never exceed the human. The route therefore
 * NO LONGER runs an all-or-nothing gate requiring `{resource}:update` on all
 * nine Langy families (the pre-ADR-043 behaviour, which 403'd a user who could
 * edit prompts but not create triggers — "restrict all of Langy"). Instead it
 * runs ONE baseline `evaluations:view` check: can the caller read this project
 * at all? A user who can read but lacks some write permissions is admitted and
 * simply gets a session key that omits the actions they can't perform. This
 * file pins that contract.
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
    hasProjectPermission: (...args: unknown[]) => hasProjectPermission(...args),
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
    // `emailVerified: true` mirrors what OAuth providers assert + what
    // BetterAuth stores after a verified signup. The Langy access gate now
    // requires it (see isLangwatchStaff in src/utils/isLangwatchStaff.ts)
    // so the staff bypass is closed to attacker@langwatch.ai self-registered
    // accounts in self-hosted email-password mode.
    user: { email: "dev@langwatch.ai", emailVerified: true, id: "u1" },
  });
});

describe("/api/langy/chat coarse RBAC gate", () => {
  describe("when the caller can read the project", () => {
    it("passes the gate with a single evaluations:view check", async () => {
      hasProjectPermission.mockResolvedValue(true);

      const res = await postChat(VALID_BODY);

      // The handler proceeds past the perm gate. It 5xx/4xxs later because
      // nothing downstream is mocked — but it must NOT 403 with the
      // permission-denied body.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      expect(body.error).not.toBe(
        "You do not have permission to use Langy for this project.",
      );
      // Exactly ONE baseline check — proves the all-or-nothing 9-permission
      // loop is gone; per-session key scoping (ADR-043) is the real gate.
      expect(hasProjectPermission).toHaveBeenCalledTimes(1);
      expect(hasProjectPermission).toHaveBeenCalledWith(
        expect.anything(),
        "p1",
        "evaluations:view",
      );
    });
  });

  describe("when the caller cannot read the project", () => {
    it("403s with the permission-denied body", async () => {
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

  describe("when the caller can read but lacks some Langy write permissions", () => {
    it("is admitted, not blocked — Langy is scoped down, not switched off", async () => {
      // A user who can view the project but (pre-ADR-043) lacked e.g.
      // triggers:update was 403'd outright. Now the coarse gate only asks
      // "can you read this project?" (evaluations:view → true), so they pass;
      // the per-session key minted downstream simply won't carry the actions
      // they can't perform. We prove the route no longer consults every write
      // permission by asserting a single baseline check.
      hasProjectPermission.mockResolvedValue(true);

      const res = await postChat(VALID_BODY);
      const body = (await res.json().catch(() => ({}))) as { error?: string };

      expect(body.error).not.toBe(
        "You do not have permission to use Langy for this project.",
      );
      expect(hasProjectPermission).toHaveBeenCalledTimes(1);
    });
  });
});
