import { describe, expect, it, vi } from "vitest";
import { runTurn, type RunTurnDeps } from "../langy-turn.processor";
import type { LangyTurnJobData } from "../langy-worker-pool";

/**
 * ADR-048: when the manager streams a terminal `handoff` frame, runTurn must
 * persist the opaque resume token (recordTurnHandoff) instead of finalizing,
 * and it must thread a pending resume token onto the manager /chat body.
 */

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

function makeBuffer() {
  return {
    heartbeat: vi.fn(async () => {}),
    appendChunk: vi.fn(async () => {}),
    appendMilestone: vi.fn(async () => {}),
    markEnd: vi.fn(async () => {}),
    markError: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
  };
}

function makeConversations() {
  return {
    recordTurnHandoff: vi.fn(async () => {}),
    finalizeTurn: vi.fn(async () => ({ messageId: "m" })),
    failTurn: vi.fn(async () => {}),
    recordToolCallCompleted: vi.fn(async () => {}),
  };
}

function job(overrides?: Partial<LangyTurnJobData>): LangyTurnJobData {
  return {
    projectId: "p1",
    conversationId: "c1",
    turnId: "t1",
    actorUserId: "alice",
    prompt: "hi",
    system: "sys",
    permitReserved: false,
    credentials: {} as LangyTurnJobData["credentials"],
    ...overrides,
  } as LangyTurnJobData;
}

function deps(overrides: Partial<RunTurnDeps>): RunTurnDeps {
  return {
    conversations: makeConversations() as unknown as RunTurnDeps["conversations"],
    ephemeral: { publish: vi.fn(async () => {}) } as unknown as RunTurnDeps["ephemeral"],
    buffer: makeBuffer() as unknown as RunTurnDeps["buffer"],
    agentUrl: "http://manager",
    internalSecret: "secret",
    ...overrides,
  } as RunTurnDeps;
}

describe("runTurn (ADR-048 shutdown-handoff)", () => {
  describe("given the manager streams a terminal handoff frame", () => {
    it("persists the resume token and does not finalize the turn", async () => {
      const conversations = makeConversations();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          '{"type":"message.part.delta","properties":{"field":"text","delta":"partial answer"}}',
          '{"type":"handoff","token":"opaque-resume-token"}',
        ]),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({
          conversations: conversations as unknown as RunTurnDeps["conversations"],
          fetchImpl,
        }),
      );

      expect(conversations.recordTurnHandoff).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "p1",
          conversationId: "c1",
          turnId: "t1",
          token: "opaque-resume-token",
        }),
      );
      expect(conversations.finalizeTurn).not.toHaveBeenCalled();
      expect(conversations.failTurn).not.toHaveBeenCalled();
    });
  });

  describe("given a pending resume token on the job", () => {
    it("threads it onto the manager /chat request body", async () => {
      let sentBody: Record<string, unknown> = {};
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return ndjsonResponse(['{"type":"handoff","token":"x"}']);
      }) as unknown as typeof fetch;

      await runTurn(
        job({ resumeToken: "prior-checkpoint" }),
        deps({ fetchImpl }),
      );

      expect(sentBody.resumeToken).toBe("prior-checkpoint");
    });

    it("omits the resume token on a cold start", async () => {
      let sentBody: Record<string, unknown> = {};
      const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return ndjsonResponse(['{"type":"handoff","token":"x"}']);
      }) as unknown as typeof fetch;

      await runTurn(job(), deps({ fetchImpl }));

      expect(sentBody).not.toHaveProperty("resumeToken");
    });
  });
});
