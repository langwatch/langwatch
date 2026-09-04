/**
 * `Prefer: wait=<seconds>` synchronous delivery and the dark-rollout refusal
 * chain on `/api/langy/conversations`, driven through the real route.
 *
 * Ports are faked rather than the framework auth chain: every route on this
 * family declares `handlerManagedAuth`, so `resolveLangyRestCaller` IS the
 * authentication, and the security spine below authenticates nothing.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  type LangyConversationTurnWireEvent,
} from "@langwatch/langy-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { LangyApp } from "#app/langy.app";
import {
  createLangyTurnsRestApp,
  type LangyTurnsRestPorts,
} from "../langy-turns.api";

const PROJECT_ID = "project-123";
const ORGANIZATION_ID = "org-1";
const USER_ID = "user-1";

const TURN_URL = "http://api.test/api/langy/conversations";
const VALID_TURN_BODY = {
  idempotencyKey: "idem-1",
  messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
};

function respondedEvent(input: { turnId: string; text: string }): LangyConversationTurnWireEvent {
  return {
    id: `evt-${input.turnId}`,
    createdAt: 1,
    occurredAt: 1,
    type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
    data: {
      conversationId: "conv-1",
      turnId: input.turnId,
      messageId: `msg-${input.turnId}`,
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: input.text }],
      outcome: "completed" as const,
      error: null,
    },
  };
}

type TailPage = {
  events: LangyConversationTurnWireEvent[];
  cursor: { acceptedAt: number; eventId: string };
  truncated: boolean;
};

const emptyTail: TailPage = { events: [], cursor: { acceptedAt: 0, eventId: "" }, truncated: false };

/** No route here is expected to throw, so a failure must be legible, not swallowed. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => next();
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}

/** `LangyApp` over a Proxy the way `AnnotationApp` is faked in the annotation family's tests. */
function fakeLangyApp(langyService: {
  startConversationTurn: ReturnType<typeof vi.fn>;
  getEventsAfter: ReturnType<typeof vi.fn>;
}): LangyApp {
  const methods = { langyService };
  return new Proxy(LangyApp.prototype, {
    get(target, property, receiver) {
      if (property in methods) return methods[property as keyof typeof methods];
      return Reflect.get(target, property, receiver);
    },
  }) as LangyApp;
}

function buildApi(options: { surfaceOpen?: boolean } = {}) {
  const surfaceOpen = options.surfaceOpen ?? true;
  const markUsed = vi.fn();
  const enforceCeiling = vi.fn(async () => undefined);
  const startConversationTurn = vi.fn(async () => ({
    conversationId: "conv-1",
    turnId: "turn-1",
  }));
  const getEventsAfter = vi.fn(async (): Promise<TailPage> => emptyTail);

  const ports: LangyTurnsRestPorts = {
    readCredential: () => ({ token: "test-token", projectId: PROJECT_ID }),
    apiKeys: () =>
      ({
        tryResolveToken: vi.fn(async () => ({
          type: "apiKey" as const,
          apiKeyId: "key-1",
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          ingestSourceType: null,
          ingestionTemplateId: null,
          project: {
            id: PROJECT_ID,
            name: "Project",
            slug: "project",
            teamId: "team-1",
            organizationId: ORGANIZATION_ID,
            isPersonal: false,
            ownerUserId: null,
          },
        })),
        markUsed,
      }) as never,
    enforceCeiling,
    featureFlags: () => ({ isEnabled: vi.fn(async () => surfaceOpen) }) as never,
    actors: () =>
      ({
        user: {
          findUnique: vi.fn(async () => ({
            id: USER_ID,
            name: "Ada",
            email: "ada@example.com",
          })),
        },
      }) as never,
    langy: () => fakeLangyApp({ startConversationTurn, getEventsAfter }),
    redis: () => null,
  };

  const app = createLangyTurnsRestApp({ security: passThroughSecurity(), ports });

  return {
    enforceCeiling,
    startConversationTurn,
    getEventsAfter,
    postTurn: (headers: Record<string, string> = {}, body: unknown = VALID_TURN_BODY) =>
      app.request(TURN_URL, {
        method: "POST",
        headers: { "X-Auth-Token": "test-token", "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    // Same app, a path that was never registered — the ground truth the dark
    // surface has to match (sharing the app matters: it proves no handler in
    // THIS chain overrides the default 404).
    unmounted: () =>
      app.request("http://api.test/api/langy/not-a-real-route", { method: "POST" }),
  };
}

describe("POST /api/langy/conversations wait mode (Prefer: wait)", () => {
  /** @scenario "A caller preferring to wait receives the assistant's output synchronously" */
  it("returns the assistant reply with 200 and Preference-Applied when the turn settles", async () => {
    const { postTurn, getEventsAfter } = buildApi();
    getEventsAfter.mockResolvedValue({
      events: [respondedEvent({ turnId: "turn-1", text: "hello back" })],
      cursor: { acceptedAt: 1, eventId: "evt-turn-1" },
      truncated: false,
    });

    const res = await postTurn({ Prefer: "wait=30" });

    expect(res.status).toBe(200);
    expect(res.headers.get("preference-applied")).toBe("wait=30");
    await expect(res.json()).resolves.toEqual({
      conversationId: "conv-1",
      turnId: "turn-1",
      status: "completed",
      error: null,
      reply: { role: "assistant", text: "hello back" },
    });
  });

  /** @scenario "A wait is satisfied only by the turn this request started" */
  it("is keyed on this request's turnId, not any terminal event on the conversation", async () => {
    const { postTurn, getEventsAfter } = buildApi();
    getEventsAfter
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
    const { postTurn, getEventsAfter } = buildApi();
    const failedEvent: LangyConversationTurnWireEvent = {
      id: "evt-fail",
      createdAt: 1,
      occurredAt: 1,
      type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
      data: { conversationId: "conv-1", turnId: "turn-1", error: "model exploded" },
    };
    getEventsAfter.mockResolvedValue({
      events: [failedEvent],
      cursor: { acceptedAt: 1, eventId: "evt-fail" },
      truncated: false,
    });

    const res = await postTurn({ Prefer: "wait=30" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      conversationId: "conv-1",
      turnId: "turn-1",
      status: "failed",
      error: "model exploded",
      reply: null,
    });
  });

  /** @scenario "A plain-text message is accepted without the parts structure" */
  it("normalizes a `content` string message into a single text part", async () => {
    const { postTurn, startConversationTurn } = buildApi();

    const res = await postTurn(
      {},
      {
        idempotencyKey: "idem-2",
        messages: [
          { role: "user", content: "hello from a plain client" },
          { role: "assistant", content: "ignored", parts: [{ type: "text", text: "kept" }] },
        ],
      },
    );

    expect(res.status).toBe(202);
    expect(startConversationTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "user", parts: [{ type: "text", text: "hello from a plain client" }] },
          { role: "assistant", parts: [{ type: "text", text: "kept" }] },
        ],
      }),
    );
  });

  /** @scenario "An expired wait degrades to the asynchronous acceptance" */
  it("degrades to the exact async 202 when the wait expires unsettled", async () => {
    const { postTurn, getEventsAfter } = buildApi();
    getEventsAfter.mockResolvedValue(emptyTail);

    const res = await postTurn({ Prefer: "wait=1" });

    expect(res.status).toBe(202);
    expect(res.headers.get("preference-applied")).toBeNull();
    await expect(res.json()).resolves.toEqual({ conversationId: "conv-1", turnId: "turn-1" });
  });
});

describe("POST /api/langy/conversations rollback switch", () => {
  /** @scenario "A switched-off surface answers exactly as a route that does not exist" */
  it("answers a valid credential with the same response an unmounted path gives", async () => {
    const { postTurn, unmounted } = buildApi({ surfaceOpen: false });

    const dark = await postTurn();
    const notFound = await unmounted();
    const [darkBody, notFoundBody] = await Promise.all([dark.text(), notFound.text()]);

    expect(dark.status).toBe(notFound.status);
    expect(dark.headers.get("content-type")).toBe(notFound.headers.get("content-type"));
    expect(darkBody).toBe(notFoundBody);
    expect(dark.status).toBe(404);
    expect(dark.headers.get("content-type")).not.toContain("application/json");
    expect(darkBody).not.toContain("trace_id");
  });

  /** @scenario "The rollback switch is checked before the caller's permissions" */
  it("stays dark for a key that would fail the langy:create ceiling", async () => {
    const { postTurn, enforceCeiling } = buildApi({ surfaceOpen: false });
    enforceCeiling.mockRejectedValue(new Error("ceiling should never be consulted while dark"));

    const res = await postTurn();

    expect(res.status).toBe(404);
    expect(enforceCeiling).not.toHaveBeenCalled();
  });
});
