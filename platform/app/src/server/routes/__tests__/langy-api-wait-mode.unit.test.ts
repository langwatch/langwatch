/**
 * @vitest-environment node
 *
 * The synchronous wait mode of `/api/langy` (`Prefer: wait=<seconds>`,
 * RFC 7240), driven through the real Hono app exactly like the refusal-chain
 * suite next door.
 *
 * The properties pinned here:
 *
 *   - No preference means the async contract is untouched: 202, ids only, and
 *     the durable fold is never even consulted.
 *   - A settled turn comes back 200 with `Preference-Applied: wait=<applied>`
 *     (the value echoed per RFC 7240 §3, so a capped caller can tell) and the
 *     assistant's text, keyed on the turnId THIS request started — a terminal
 *     event for some other turn on the same conversation must not satisfy the
 *     wait.
 *   - A failed turn is still a 200: the REQUEST succeeded, and the failure is
 *     the turn's own outcome, carried in `status`/`error`.
 *   - Expiry degrades to the exact 202 the async path returns, with no
 *     `Preference-Applied` — a caller cannot tell it from never having asked.
 *   - Projection lag (`LangyConversationNotFoundError` from the fold read)
 *     means "keep waiting", not "gone".
 */
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy-contract";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import { getApp } from "~/server/app-layer/app";

// ─── Auth mocks (same seam as langy-api-refusal-chain.unit.test.ts) ───────────
const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();

const mockExtractCredentials = vi.fn();
const mockEnforceApiKeyCeiling = vi.fn();

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    extractCredentials: (...args: unknown[]) => mockExtractCredentials(...args),
    enforceApiKeyCeiling: (...args: unknown[]) =>
      mockEnforceApiKeyCeiling(...args),
  };
});

vi.mock("~/server/db", () => ({ prisma: {} }));

const mockIsEnabled = vi.fn();

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => mockIsEnabled(...args),
  },
}));

const mockResolveLangyKeyIdentity = vi.fn();
const mockResolveLangyActorSession = vi.fn();

vi.mock("~/server/app-layer/langy/langyApiKeyIdentity", () => ({
  resolveLangyKeyIdentity: (...args: unknown[]) =>
    mockResolveLangyKeyIdentity(...args),
}));

vi.mock("~/server/app-layer/langy/langyApiKeyActorSession", () => ({
  resolveLangyActorSession: (...args: unknown[]) =>
    mockResolveLangyActorSession(...args),
}));

// ─── App layer ────────────────────────────────────────────────────────────────
const mockStartConversationTurn = vi.fn();
const mockGetEventsAfter = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    apiKeys: {
      tryResolveToken: mockResolve,
      markUsed: mockMarkUsed,
    },
    langy: {
      startConversationTurn: mockStartConversationTurn,
      getEventsAfter: mockGetEventsAfter,
    },
  })),
  // No Redis in this suite: awaitTurnSettlement exercises its fold-poll
  // fallback, which is the deterministic path a unit suite can pin.
  tryGetApp: vi.fn(() => null),
}));

// Imported AFTER every mock, same as the sibling suite.
const { app: langyApp } = await import("../langy-api");

const testApp = new Hono();
testApp.use("*", appContextMiddlewareFor(getApp()));
testApp.route("/", langyApp);

const TURN_URL = "http://localhost/api/langy/conversations";

const VALID_TURN_BODY = {
  idempotencyKey: "idem-1",
  messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
};

function postTurn(headers: Record<string, string> = {}) {
  return testApp.request(TURN_URL, {
    method: "POST",
    headers: {
      "X-Auth-Token": "test-token",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(VALID_TURN_BODY),
  });
}

function respondedEvent({
  turnId,
  text,
  outcome = "completed",
  error = null,
}: {
  turnId: string;
  text: string;
  outcome?: string;
  error?: string | null;
}) {
  return {
    id: `evt-${turnId}`,
    createdAt: 1,
    occurredAt: 1,
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    data: {
      conversationId: "conv-1",
      turnId,
      messageId: `msg-${turnId}`,
      role: "assistant",
      parts: [{ type: "text", text }],
      outcome,
      error,
    },
  };
}

const emptyTail = {
  events: [],
  cursor: { acceptedAt: 0, eventId: "" },
  truncated: false,
};

describe("/api/langy wait mode (Prefer: wait)", () => {
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
      conversationId: "conv-1",
      turnId: "turn-1",
    });
  });

  it("keeps the async 202 contract untouched when no preference is sent", async () => {
    const res = await postTurn();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      conversationId: "conv-1",
      turnId: "turn-1",
    });
    expect(res.headers.get("preference-applied")).toBeNull();
    expect(mockGetEventsAfter).not.toHaveBeenCalled();
  });

  it("ignores an unparseable wait preference and answers 202", async () => {
    const res = await postTurn({ Prefer: "wait=soon, respond-async" });

    expect(res.status).toBe(202);
    expect(mockGetEventsAfter).not.toHaveBeenCalled();
  });

  /** @scenario "A caller preferring to wait receives the assistant's output synchronously" */
  it("returns the assistant reply with 200 and Preference-Applied when the turn settles", async () => {
    mockGetEventsAfter.mockResolvedValue({
      events: [respondedEvent({ turnId: "turn-1", text: "hello back" })],
      cursor: { acceptedAt: 1, eventId: "evt-turn-1" },
      truncated: false,
    });

    const res = await postTurn({ Prefer: "wait=30" });

    expect(res.status).toBe(200);
    expect(res.headers.get("preference-applied")).toBe("wait=30");
    expect(await res.json()).toEqual({
      conversationId: "conv-1",
      turnId: "turn-1",
      status: "completed",
      error: null,
      reply: { role: "assistant", text: "hello back" },
    });
    // The wait authorizes the fold read as the same user the credential
    // bridged to — not some ambient identity.
    expect(mockGetEventsAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-123",
        conversationId: "conv-1",
        userId: "user-1",
      }),
    );
  });

  /** @scenario "A wait is satisfied only by the turn this request started" */
  it("is keyed on THIS request's turnId, not any terminal event", async () => {
    mockGetEventsAfter
      .mockResolvedValueOnce({
        events: [respondedEvent({ turnId: "turn-OTHER", text: "not yours" })],
        cursor: { acceptedAt: 1, eventId: "evt-turn-OTHER" },
        truncated: false,
      })
      .mockResolvedValue({
        events: [respondedEvent({ turnId: "turn-1", text: "yours" })],
        cursor: { acceptedAt: 2, eventId: "evt-turn-1" },
        truncated: false,
      });

    vi.useFakeTimers();
    try {
      const pending = postTurn({ Prefer: "wait=30" });
      await vi.advanceTimersByTimeAsync(1_000);
      const res = await pending;
      const body = (await res.json()) as { reply: { text: string } };

      expect(res.status).toBe(200);
      expect(body.reply.text).toBe("yours");
    } finally {
      vi.useRealTimers();
    }
  });

  /** @scenario "A failed turn settles the wait as a domain outcome, not a transport refusal" */
  it("reports a failed turn as a 200 with the turn's own error, reply null", async () => {
    mockGetEventsAfter.mockResolvedValue({
      events: [
        {
          id: "evt-fail",
          createdAt: 1,
          occurredAt: 1,
          type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
          data: {
            conversationId: "conv-1",
            turnId: "turn-1",
            error: "model exploded",
          },
        },
      ],
      cursor: { acceptedAt: 1, eventId: "evt-fail" },
      truncated: false,
    });

    const res = await postTurn({ Prefer: "wait=30" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      conversationId: "conv-1",
      turnId: "turn-1",
      status: "failed",
      error: "model exploded",
      reply: null,
    });
  });

  it("treats projection lag as keep-waiting, not gone", async () => {
    const { LangyConversationNotFoundError } = await import(
      "@langwatch/langy-contract"
    );
    mockGetEventsAfter
      .mockRejectedValueOnce(new LangyConversationNotFoundError("conv-1"))
      .mockResolvedValue({
        events: [respondedEvent({ turnId: "turn-1", text: "late but here" })],
        cursor: { acceptedAt: 1, eventId: "evt-turn-1" },
        truncated: false,
      });

    vi.useFakeTimers();
    try {
      const pending = postTurn({ Prefer: "wait=30" });
      await vi.advanceTimersByTimeAsync(1_000);
      const res = await pending;
      const body = (await res.json()) as { reply: { text: string } };

      expect(res.status).toBe(200);
      expect(body.reply.text).toBe("late but here");
    } finally {
      vi.useRealTimers();
    }
  });

  /** @scenario "A plain-text message is accepted without the parts structure" */
  it("normalizes a `content` string message into a single text part", async () => {
    const res = await testApp.request(TURN_URL, {
      method: "POST",
      headers: {
        "X-Auth-Token": "test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: "idem-2",
        messages: [
          { role: "user", content: "hello from a plain client" },
          // parts wins over content when both are present
          {
            role: "assistant",
            content: "ignored",
            parts: [{ type: "text", text: "kept" }],
          },
        ],
      }),
    });

    expect(res.status).toBe(202);
    expect(mockStartConversationTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "hello from a plain client" }],
          },
          { role: "assistant", parts: [{ type: "text", text: "kept" }] },
        ],
      }),
    );
  });

  /** @scenario "An expired wait degrades to the asynchronous acceptance" */
  it("degrades to the exact async 202 when the wait expires unsettled", async () => {
    mockGetEventsAfter.mockResolvedValue(emptyTail);

    const res = await postTurn({ Prefer: "wait=1" });

    expect(res.status).toBe(202);
    expect(res.headers.get("preference-applied")).toBeNull();
    expect(await res.json()).toEqual({
      conversationId: "conv-1",
      turnId: "turn-1",
    });
  });

  it("caps the wait at MAX_WAIT_SECONDS and echoes the applied value", async () => {
    mockGetEventsAfter.mockResolvedValue({
      events: [respondedEvent({ turnId: "turn-1", text: "capped" })],
      cursor: { acceptedAt: 1, eventId: "evt-turn-1" },
      truncated: false,
    });

    const res = await postTurn({ Prefer: "wait=99999" });

    expect(res.status).toBe(200);
    // RFC 7240 §3: the echoed value is how the caller learns the cap.
    expect(res.headers.get("preference-applied")).toBe("wait=120");
  });

  it("treats wait=0 as no preference: 202 without consulting the fold", async () => {
    const res = await postTurn({ Prefer: "wait=0" });

    expect(res.status).toBe(202);
    expect(res.headers.get("preference-applied")).toBeNull();
    expect(mockGetEventsAfter).not.toHaveBeenCalled();
  });

  it("ignores a negative wait and answers 202", async () => {
    const res = await postTurn({ Prefer: "wait=-5" });

    expect(res.status).toBe(202);
    expect(mockGetEventsAfter).not.toHaveBeenCalled();
  });

  it("parses wait when it is not the first preference in the header", async () => {
    mockGetEventsAfter.mockResolvedValue({
      events: [respondedEvent({ turnId: "turn-1", text: "mid-header" })],
      cursor: { acceptedAt: 1, eventId: "evt-turn-1" },
      truncated: false,
    });

    const res = await postTurn({ Prefer: "respond-async, wait=30" });

    expect(res.status).toBe(200);
    expect(res.headers.get("preference-applied")).toBe("wait=30");
  });

  it('parses the RFC 7240 quoted-string form wait="30"', async () => {
    mockGetEventsAfter.mockResolvedValue({
      events: [respondedEvent({ turnId: "turn-1", text: "quoted" })],
      cursor: { acceptedAt: 1, eventId: "evt-turn-1" },
      truncated: false,
    });

    const res = await postTurn({ Prefer: 'wait="30"' });

    expect(res.status).toBe(200);
    expect(res.headers.get("preference-applied")).toBe("wait=30");
  });

  it("stops waiting and degrades to 202 when the client disconnects", async () => {
    mockGetEventsAfter.mockResolvedValue(emptyTail);
    const client = new AbortController();

    const pending = testApp.request(TURN_URL, {
      method: "POST",
      headers: {
        "X-Auth-Token": "test-token",
        "Content-Type": "application/json",
        Prefer: "wait=30",
      },
      body: JSON.stringify(VALID_TURN_BODY),
      signal: client.signal,
    });
    // Let the turn start and the wait enter its first poll delay, then walk away.
    await new Promise((resolve) => setTimeout(resolve, 50));
    client.abort();
    const res = await pending;

    expect(res.status).toBe(202);
    expect(res.headers.get("preference-applied")).toBeNull();
  });
});
