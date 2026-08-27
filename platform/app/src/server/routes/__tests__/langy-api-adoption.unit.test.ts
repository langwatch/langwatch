/**
 * @vitest-environment node
 *
 * Conversation-id ADOPTION at the route boundary, driven through the real Hono
 * app exactly like the wait-mode and refusal-chain suites next door.
 *
 * Adoption lets a caller bind continuity to an id it chose itself, which is what
 * scenario runs need: they key every turn of a run on one `{{ threadId }}`.
 * Before the flag existed, an unknown id was silently replaced with a freshly
 * minted one, so every multi-turn run degraded to a series of single-turn
 * conversations with no signal anywhere that it had happened (#7187).
 *
 * The properties pinned here are the two halves of that contract:
 *
 *   - The flag is OPT-IN and forwarded verbatim. A body that does not ask for
 *     adoption must not have it turned on underneath, or the old silent
 *     behaviour comes back through the other door.
 *   - Asking for adoption without an id in the path is rejected, loudly. There
 *     is no id to adopt, and the only alternative reading — ignore the flag and
 *     mint a fresh conversation — is precisely the ghost-conversation failure
 *     the flag exists to prevent.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import { createTestApp } from "~/server/app-layer/presets";

// ─── Auth mocks (same seam as langy-api-wait-mode.unit.test.ts) ───────────────
const mockExtractCredentials = vi.fn();
const mockEnforceApiKeyCeiling = vi.fn();

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    extractCredentials: (...args: unknown[]) => mockExtractCredentials(...args),
    enforceApiKeyCeiling: (...args: unknown[]) => mockEnforceApiKeyCeiling(...args),
  };
});

const mockResolveLangyKeyIdentity = vi.fn();
const mockResolveLangyActorSession = vi.fn();

vi.mock("~/runtime/app/features/langy-api-key-identity.adapter", () => ({
  resolveLangyKeyIdentity: (...args: unknown[]) => mockResolveLangyKeyIdentity(...args),
}));

vi.mock("~/runtime/app/features/langy-api-key-actor-session.adapter", () => ({
  resolveLangyActorSession: (...args: unknown[]) => mockResolveLangyActorSession(...args),
}));

const featureFlags = MemoryFeatureFlagService.create();
const processApp = createTestApp({ featureFlags });
const mockIsEnabled = vi.spyOn(featureFlags, "isEnabled");
const mockResolve = vi.spyOn(processApp.apiKeys, "tryResolveToken");
const mockMarkUsed = vi.spyOn(processApp.apiKeys, "markUsed");
const mockStartConversationTurn = vi.spyOn(processApp.langy, "startConversationTurn");
const mockGetEventsAfter = vi.spyOn(processApp.langy, "getEventsAfter");

// Imported AFTER every mock, same as the sibling suites.
const { app: langyApp } = await import("../langy-api");

const testApp = new Hono();
testApp.use("*", appContextMiddlewareFor(processApp));
testApp.route("/", langyApp);

const CONVERSATIONS_URL = "http://localhost/api/langy/conversations";
const ADOPTED_ID = "run-42-thread";

function postTurn({ path = "", body }: { path?: string; body: Record<string, unknown> }) {
  return testApp.request(`${CONVERSATIONS_URL}${path}`, {
    method: "POST",
    headers: {
      "X-Auth-Token": "test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const MESSAGES = [{ role: "user", parts: [{ type: "text", text: "hi" }] }];

describe("/api/langy conversation-id adoption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractCredentials.mockReturnValue({
      token: "test-token",
      projectId: "project-123",
    });
    mockResolve.mockResolvedValue({
      type: "apiKey" as const,
      apiKeyId: "key-1",
      project: { id: "project-123", team: { organizationId: "org-1" } },
    });
    mockIsEnabled.mockResolvedValue(true);
    mockEnforceApiKeyCeiling.mockResolvedValue(undefined);
    mockResolveLangyKeyIdentity.mockResolvedValue({
      ok: true,
      userId: "user-1",
    });
    mockResolveLangyActorSession.mockResolvedValue({
      ok: true,
      session: { user: { id: "user-1" } },
    });
    mockStartConversationTurn.mockResolvedValue({
      conversationId: ADOPTED_ID,
      turnId: "turn-1",
    });
  });

  describe("when a request asks to adopt the id in the path", () => {
    it("forwards the flag to the turn service alongside that id", async () => {
      const res = await postTurn({
        path: `/${ADOPTED_ID}/messages`,
        body: {
          idempotencyKey: "idem-1",
          messages: MESSAGES,
          adoptConversationId: true,
        },
      });

      expect(res.status).toBe(202);
      expect(mockStartConversationTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedConversationId: ADOPTED_ID,
          adoptConversationId: true,
        }),
      );
    });
  });

  describe("when a request does not mention adoption", () => {
    it("does not turn it on underneath, so the flag stays opt-in", async () => {
      const res = await postTurn({
        path: `/${ADOPTED_ID}/messages`,
        body: { idempotencyKey: "idem-1", messages: MESSAGES },
      });

      expect(res.status).toBe(202);
      const [args] = mockStartConversationTurn.mock.calls[0] as [Record<string, unknown>];
      expect(args).not.toHaveProperty("adoptConversationId");
    });
  });

  describe("when adoption is asked for on the route with no id in the path", () => {
    it("rejects the request instead of quietly minting a fresh conversation", async () => {
      const res = await postTurn({
        body: {
          idempotencyKey: "idem-1",
          messages: MESSAGES,
          adoptConversationId: true,
        },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe("langy_api_request_invalid");
      // The point of the rejection: no turn was started at all. A 400 that had
      // already minted a conversation would leave the ghost behind anyway.
      expect(mockStartConversationTurn).not.toHaveBeenCalled();
    });
  });
});
