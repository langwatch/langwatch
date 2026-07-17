/**
 * LangyTurnRelay is the successor to runTurn's streaming role and a SECURITY
 * boundary: it verifies each pushed frame, pins it to the connection's turn,
 * dedups replays, and fans it to the live buffer + the durable event log. These
 * drive it with REAL signed envelopes (langyFrameAuth.signFrame) so the auth
 * path is exercised end to end, and lock which frames become durable events.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintRunToken, signFrame } from "../langyFrameAuth";
import {
  LangyTurnRelay,
  type LangyRelayBuffer,
  type LangyRelayConversations,
} from "../langyTurnRelay";

const RUN_TOKEN = mintRunToken();
const IDENTITY = {
  projectId: "proj-1",
  userId: "user-1",
  conversationId: "conv-1",
  turnId: "turn-1",
};

function fakeBuffer() {
  return {
    appendChunk: vi.fn(async () => {}),
    appendReasoning: vi.fn(async () => {}),
    appendStatus: vi.fn(async () => {}),
    appendProgress: vi.fn(async () => {}),
    appendMilestone: vi.fn(async () => {}),
    appendPlan: vi.fn(async () => {}),
    appendTool: vi.fn(async () => {}),
    markEnd: vi.fn(async () => {}),
    markError: vi.fn(async () => {}),
    heartbeat: vi.fn(async () => {}),
  } satisfies LangyRelayBuffer;
}

function fakeConversations(runToken: string | null = RUN_TOKEN) {
  return {
    getRunToken: vi.fn(async () => runToken),
    recordToolCallStarted: vi.fn(async () => {}),
    recordToolCallCompleted: vi.fn(async () => {}),
    ingestAgentTurnResult: vi.fn(async () => {}),
    recordTurnHandoff: vi.fn(async () => {}),
    recordPlanUpdated: vi.fn(async () => {}),
  } satisfies LangyRelayConversations;
}

function makeRelay(
  over: {
    conversations?: ReturnType<typeof fakeConversations>;
    fresh?: boolean;
  } = {},
) {
  const buffer = fakeBuffer();
  const conversations = over.conversations ?? fakeConversations();
  const reserveFrameNonce = vi.fn(async () => over.fresh ?? true);
  const relay = new LangyTurnRelay({
    buffer,
    conversations,
    reserveFrameNonce,
  });
  return { relay, buffer, conversations, reserveFrameNonce };
}

/** A real signed envelope for a payload object. */
const frame = (payload: unknown, identity = IDENTITY, runToken = RUN_TOKEN) =>
  signFrame(runToken, identity, JSON.stringify(payload));

describe("LangyTurnRelay", () => {
  describe("given ephemeral frames", () => {
    it("appends a token delta to the live buffer only", async () => {
      const { relay, buffer, conversations } = makeRelay();
      const out = await relay.handle(frame({ type: "delta", text: "hello" }));

      expect(out).toEqual({ status: "applied" });
      expect(buffer.appendChunk).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
        text: "hello",
      });
      expect(conversations.ingestAgentTurnResult).not.toHaveBeenCalled();
    });

    it("appends reasoning to the live buffer only — never durable", async () => {
      const { relay, buffer, conversations } = makeRelay();
      const out = await relay.handle(
        frame({ type: "reasoning", text: "let me check the traces" }),
      );

      expect(out).toEqual({ status: "applied" });
      expect(buffer.appendReasoning).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
        text: "let me check the traces",
      });
      // Ephemeral: no fold ingest, and it must not touch the durable answer.
      expect(conversations.ingestAgentTurnResult).not.toHaveBeenCalled();
    });

    it("routes a heartbeat to liveness with no content", async () => {
      const { relay, buffer } = makeRelay();
      await relay.handle(frame({ type: "heartbeat" }));
      expect(buffer.heartbeat).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
      });
    });

    it("renders a mid-stream UI card via the milestone slot", async () => {
      const { relay, buffer } = makeRelay();
      await relay.handle(
        frame({ type: "card", kind: "trace_download", detail: "trace-9" }),
      );
      expect(buffer.appendMilestone).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
        kind: "trace_download",
        detail: "trace-9",
      });
    });
  });

  describe("given a plan snapshot frame", () => {
    it("mirrors it to the live buffer AND records the durable plan_updated", async () => {
      const { relay, buffer, conversations } = makeRelay();
      const items = [
        { content: "Find the slow traces", status: "completed" },
        { content: "Summarise them", status: "in_progress" },
      ];
      const out = await relay.handle(frame({ type: "plan", items }));

      expect(out).toEqual({ status: "applied" });
      expect(buffer.appendPlan).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
        items,
      });
      expect(conversations.recordPlanUpdated).toHaveBeenCalledWith({
        projectId: "proj-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        items,
      });
    });

    it("rejects an over-cap plan frame rather than mirroring model text unbounded", async () => {
      const { relay, buffer, conversations } = makeRelay();
      // 51 items > the 50-item cap; a legitimate manager frame never exceeds 30.
      const items = Array.from({ length: 51 }, (_, i) => ({
        content: `step ${i}`,
        status: "pending",
      }));
      const out = await relay.handle(frame({ type: "plan", items }));

      expect(out).toEqual({ status: "rejected", reason: "invalid-payload" });
      expect(buffer.appendPlan).not.toHaveBeenCalled();
      expect(conversations.recordPlanUpdated).not.toHaveBeenCalled();
    });

    it("rejects a plan item whose content blows past the length cap", async () => {
      const { relay, buffer } = makeRelay();
      const items = [{ content: "x".repeat(501), status: "in_progress" }];
      const out = await relay.handle(frame({ type: "plan", items }));

      expect(out).toEqual({ status: "rejected", reason: "invalid-payload" });
      expect(buffer.appendPlan).not.toHaveBeenCalled();
    });
  });

  describe("given a LangWatch capability tool call", () => {
    it("emits a present-continuous sub-status on start and clears it on end", async () => {
      const { relay, buffer } = makeRelay();
      await relay.handle(
        frame({
          type: "tool",
          id: "call-1",
          name: "bash",
          phase: "start",
          input: { command: "langwatch trace search --format json" },
        }),
      );
      expect(buffer.appendStatus).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
        status: "Searching traces…",
      });

      buffer.appendStatus.mockClear();
      await relay.handle(
        frame(
          {
            type: "tool",
            id: "call-1",
            name: "bash",
            phase: "end",
            isError: false,
            output: "{}",
            input: { command: "langwatch trace search --format json" },
          },
          IDENTITY,
        ),
      );
      // The step's output clears the sub-status with an empty status.
      expect(buffer.appendStatus).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
        status: "",
      });
    });

    it("emits no sub-status for a non-capability shell call", async () => {
      const { relay, buffer } = makeRelay();
      await relay.handle(
        frame({
          type: "tool",
          id: "call-2",
          name: "bash",
          phase: "start",
          input: { command: "echo hello" },
        }),
      );
      expect(buffer.appendStatus).not.toHaveBeenCalled();
    });
  });

  describe("given named tool-call frames (live card + durable milestone)", () => {
    it("records a tool start as both a card and a durable event", async () => {
      const { relay, buffer, conversations } = makeRelay();
      await relay.handle(
        frame({
          type: "tool",
          id: "tc-1",
          name: "bash",
          phase: "start",
          command: "ls",
        }),
      );
      expect(buffer.appendTool).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tc-1", name: "bash", phase: "start" }),
      );
      expect(conversations.recordToolCallStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          toolCallId: "tc-1",
          toolName: "bash",
          command: "ls",
        }),
      );
    });

    it("re-types a shell frame running the LangWatch CLI before anything is recorded", async () => {
      const { relay, buffer, conversations } = makeRelay();
      await relay.handle(
        frame({
          type: "tool",
          id: "tc-2",
          name: "bash",
          phase: "end",
          input: { command: "langwatch trace search --limit 2 --format json" },
          output:
            '✔ Found 2\n{"traces":[{"trace_id":"trace_1"},{"trace_id":"trace_2"}],"pagination":{"totalHits":34}}',
        }),
      );

      // The live card gets the capability, the canonical result envelope, and
      // the digest the browser hydrates fresh rows from.
      expect(buffer.appendTool).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tc-2",
          name: "langwatch.trace.search",
          phase: "end",
          output: JSON.stringify({
            kind: "card",
            card: "traces",
            payload: {
              traces: [{ trace_id: "trace_1" }, { trace_id: "trace_2" }],
              pagination: { totalHits: 34 },
            },
          }),
          digest: expect.objectContaining({
            resource: "trace",
            verb: "search",
            strategy: "id-ref",
            ids: ["trace_1", "trace_2"],
            counts: { returned: 2, total: 34 },
          }),
        }),
      );
      // The durable milestone is named by the capability, not by the shell.
      expect(conversations.recordToolCallCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: "tc-2",
          toolName: "langwatch.trace.search",
        }),
      );
    });

    it("carries the error output as errorText on a failed tool completion", async () => {
      const { relay, conversations } = makeRelay();
      await relay.handle(
        frame({
          type: "tool",
          id: "tc-1",
          name: "bash",
          phase: "end",
          isError: true,
          output: "boom",
          durationMs: 12,
        }),
      );
      expect(conversations.recordToolCallCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: "tc-1",
          isError: true,
          errorText: "boom",
          durationMs: 12,
        }),
      );
    });
  });

  describe("given terminal frames", () => {
    it("marks the stream end and ingests the durable completed result", async () => {
      const { relay, buffer, conversations } = makeRelay();
      const out = await relay.handle(
        frame({
          type: "final",
          text: "the answer",
          toolCalls: [{ id: "t", name: "bash" }],
        }),
      );
      expect(out).toEqual({ status: "terminal" });
      expect(buffer.markEnd).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
      });
      expect(conversations.ingestAgentTurnResult).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed", text: "the answer" }),
      );
    });

    it("marks the stream error with the CLASSIFIED domain error, not the raw prose", async () => {
      const { relay, buffer, conversations } = makeRelay();
      const out = await relay.handle(
        frame({
          type: "error",
          error: "Langy is unavailable",
          code: "at-capacity",
        }),
      );
      expect(out).toEqual({ status: "terminal" });
      // The live edge must carry the same JSON domain error the browser parses
      // (readLangyStreamError) — a raw string collapses every named failure into
      // the generic "Something went wrong". Classified from the vetted `code`.
      const markErrorArg = (buffer.markError as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as {
        conversationId: string;
        turnId: string;
        error: string;
      };
      expect(markErrorArg.conversationId).toBe("conv-1");
      expect(markErrorArg.turnId).toBe("turn-1");
      expect(JSON.parse(markErrorArg.error)).toMatchObject({
        kind: "langy_agent_at_capacity",
      });
      expect(conversations.ingestAgentTurnResult).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", errorCode: "at-capacity" }),
      );
    });

    it("classifies a worker_stopped frame into the terminal worker-stopped state", async () => {
      const { relay, buffer } = makeRelay();
      await relay.handle(
        frame({
          type: "error",
          error: "the worker stopped before finishing",
          code: "worker_stopped",
        }),
      );
      const markErrorArg = (buffer.markError as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as { error: string };
      expect(JSON.parse(markErrorArg.error)).toMatchObject({
        kind: "langy_worker_stopped",
      });
    });

    it("ends the stream and persists the resume token on a handoff (ADR-048)", async () => {
      const { relay, buffer, conversations } = makeRelay();
      const out = await relay.handle(
        frame({ type: "handoff", resumeToken: "opaque-resume" }),
      );
      expect(out).toEqual({ status: "terminal" });
      expect(buffer.markEnd).toHaveBeenCalledWith({
        conversationId: "conv-1",
        turnId: "turn-1",
      });
      // A handoff is NOT a failure — it persists the token, never ingests a result.
      expect(conversations.recordTurnHandoff).toHaveBeenCalledWith({
        projectId: "proj-1",
        conversationId: "conv-1",
        turnId: "turn-1",
        token: "opaque-resume",
      });
      expect(conversations.ingestAgentTurnResult).not.toHaveBeenCalled();
    });
  });

  describe("given an attacker or a corrupt frame", () => {
    it("rejects a tampered signature and applies nothing", async () => {
      const { relay, buffer } = makeRelay();
      const good = frame({ type: "delta", text: "hi" });
      const tampered = {
        ...good,
        payload: JSON.stringify({ type: "delta", text: "HACKED" }),
      };
      const out = await relay.handle(tampered);
      expect(out).toEqual({ status: "rejected", reason: "bad-signature" });
      expect(buffer.appendChunk).not.toHaveBeenCalled();
    });

    it("rejects when the conversation has no runToken", async () => {
      const { relay } = makeRelay({ conversations: fakeConversations(null) });
      const out = await relay.handle(frame({ type: "delta", text: "hi" }));
      expect(out).toEqual({ status: "rejected", reason: "no-run-token" });
    });

    it("rejects a frame from a different turn on the same connection (cross-turn replay)", async () => {
      const { relay, buffer } = makeRelay();
      await relay.handle(frame({ type: "delta", text: "one" })); // pins turn-1
      const out = await relay.handle(
        frame(
          { type: "delta", text: "two" },
          { ...IDENTITY, turnId: "turn-2" },
        ),
      );
      expect(out).toEqual({ status: "rejected", reason: "wrong-turn" });
      expect(buffer.appendChunk).toHaveBeenCalledTimes(1);
    });

    it("drops a replayed frameNonce as a duplicate", async () => {
      const { relay, buffer } = makeRelay({ fresh: false });
      const out = await relay.handle(frame({ type: "delta", text: "hi" }));
      expect(out).toEqual({ status: "duplicate" });
      expect(buffer.appendChunk).not.toHaveBeenCalled();
    });

    it("rejects a malformed envelope", async () => {
      const { relay } = makeRelay();
      const out = await relay.handle({ not: "an envelope" });
      expect(out).toEqual({ status: "rejected", reason: "malformed-envelope" });
    });

    it("rejects a valid envelope whose payload is not a known frame", async () => {
      const { relay } = makeRelay();
      const out = await relay.handle(frame({ type: "nonsense" }));
      expect(out).toEqual({ status: "rejected", reason: "invalid-payload" });
    });
  });

  describe("given a multi-frame turn", () => {
    it("loads the runToken once and reuses it across frames", async () => {
      const { relay, conversations } = makeRelay();
      await relay.handle(frame({ type: "delta", text: "a" }));
      await relay.handle(frame({ type: "delta", text: "b" }));
      await relay.handle(frame({ type: "final", text: "done" }));
      expect(conversations.getRunToken).toHaveBeenCalledTimes(1);
    });
  });
});
