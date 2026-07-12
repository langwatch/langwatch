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
    appendTool: vi.fn(
      async (_args: {
        phase: "start" | "end";
        name: string;
        // The shell command is the field the card labels itself from, so the
        // mock names it rather than hiding it behind `unknown`.
        input?: { command?: string };
        output?: string;
        isError?: boolean;
      }) => {},
    ),
    // The recovery loop pushes a calm status line onto the live stream before
    // each in-process retry (see langy-turn-recovery.ts).
    appendStatus: vi.fn(async (_args: { status: string }) => {}),
    markEnd: vi.fn(async () => {}),
    markError: vi.fn(
      async (_args: {
        conversationId: string;
        turnId: string;
        error: string;
      }) => {},
    ),
    flush: vi.fn(async () => {}),
  };
}

function makeConversations() {
  return {
    recordTurnHandoff: vi.fn(async () => {}),
    finalizeTurn: vi.fn(async () => ({ messageId: "m" })),
    failTurn: vi.fn(async () => {}),
    // Typed with the args they actually receive: a zero-arg `vi.fn` records its
    // calls as `never`, so every assertion about WHAT was recorded has to be
    // cast back into existence — which is how a test ends up asserting against a
    // shape it invented rather than the one the code passes.
    recordToolCallStarted: vi.fn(
      async (_args: {
        toolCallId: string;
        toolName: string;
        command?: string;
        input?: unknown;
      }) => {},
    ),
    recordToolCallCompleted: vi.fn(
      async (_args: {
        toolCallId: string;
        toolName: string;
        isError?: boolean;
        command?: string;
        input?: unknown;
        durationMs?: number;
        errorText?: string;
      }) => {},
    ),
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
    conversations:
      makeConversations() as unknown as RunTurnDeps["conversations"],
    ephemeral: {
      publish: vi.fn(async () => {}),
    } as unknown as RunTurnDeps["ephemeral"],
    buffer: makeBuffer() as unknown as RunTurnDeps["buffer"],
    agentUrl: "http://manager",
    internalSecret: "secret",
    // The server's recovery backoff is real seconds in production; a test must
    // exercise the loop, not sit through it.
    sleepImpl: async () => {},
    ...overrides,
  } as RunTurnDeps;
}

/** The kind the worker wrote onto the buffer's terminal `error` entry. */
function markedErrorKind(buffer: ReturnType<typeof makeBuffer>): string {
  const call = buffer.markError.mock.calls[0]?.[0] as
    | { error: string }
    | undefined;
  return JSON.parse(call!.error).kind as string;
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
          conversations:
            conversations as unknown as RunTurnDeps["conversations"],
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

/**
 * ADR-045: a hard turn failure ends the stream with a STRUCTURED error part.
 * The kind on that part must name what actually happened — the browser keys its
 * copy off it — and the raw manager text must never ride along.
 */
describe("runTurn (turn-failure classification)", () => {
  describe("given the manager streams an at-capacity error frame", () => {
    it("marks the turn failed as langy_agent_at_capacity once retries are spent", async () => {
      const buffer = makeBuffer();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse(['{"type":"error","error":"at-capacity"}']),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({
          buffer: buffer as unknown as RunTurnDeps["buffer"],
          fetchImpl,
        }),
      );

      expect(markedErrorKind(buffer)).toBe("langy_agent_at_capacity");
    });
  });

  describe("given the manager responds non-2xx", () => {
    it("marks the turn failed as langy_agent_unavailable carrying only the status", async () => {
      const buffer = makeBuffer();
      const fetchImpl = vi.fn(
        async () =>
          ({ ok: false, status: 503, body: null }) as unknown as Response,
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({
          buffer: buffer as unknown as RunTurnDeps["buffer"],
          fetchImpl,
        }),
      );

      const written = buffer.markError.mock.calls[0]![0].error;
      expect(JSON.parse(written)).toMatchObject({
        kind: "langy_agent_unavailable",
        meta: { status: 503 },
      });
      expect(written).not.toContain("manager responded");
    });
  });

  describe("given an unrecognised agent error frame", () => {
    it("falls back to unknown and leaks none of the raw text", async () => {
      const buffer = makeBuffer();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          '{"type":"error","error":"opencode boom at /home/langy-3/session"}',
        ]),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({
          buffer: buffer as unknown as RunTurnDeps["buffer"],
          fetchImpl,
        }),
      );

      const written = buffer.markError.mock.calls[0]![0].error;
      expect(JSON.parse(written).kind).toBe("unknown");
      expect(written).not.toContain("opencode boom");
      expect(written).not.toContain("/home/langy-3");
    });
  });
});

/**
 * SERVER-SIDE RECOVERY. Where the processor can fix a failure by simply having
 * another go, it does — in process, on the same turn. The browser never sees an
 * error at all: the user's message is not re-posted (so it cannot be duplicated),
 * no PR permit is re-reserved, and the open stream just keeps streaming.
 *
 * The gates that stop it replaying something it shouldn't are the load-bearing
 * part, so they are exercised here, not merely asserted about.
 */
describe("runTurn (server-side recovery)", () => {
  describe("given the manager is at capacity and then frees up", () => {
    it("retries in process and finishes the turn — the browser sees no error", async () => {
      const buffer = makeBuffer();
      const conversations = makeConversations();
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call++;
        return call === 1
          ? ndjsonResponse(['{"type":"error","error":"at-capacity"}'])
          : ndjsonResponse([
              '{"type":"message.part.delta","properties":{"field":"text","delta":"the answer"}}',
            ]);
      }) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({
          buffer: buffer as unknown as RunTurnDeps["buffer"],
          conversations:
            conversations as unknown as RunTurnDeps["conversations"],
          fetchImpl,
        }),
      );

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      // No error ever reached the stream, and the turn finalized normally.
      expect(buffer.markError).not.toHaveBeenCalled();
      expect(conversations.failTurn).not.toHaveBeenCalled();
      expect(conversations.finalizeTurn).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "completed" }),
      );
    });

    it("tells the user it is busy, on the stream they are already watching", async () => {
      const buffer = makeBuffer();
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call++;
        return call === 1
          ? ndjsonResponse(['{"type":"error","error":"at-capacity"}'])
          : ndjsonResponse([
              '{"type":"message.part.delta","properties":{"field":"text","delta":"ok"}}',
            ]);
      }) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({ buffer: buffer as unknown as RunTurnDeps["buffer"], fetchImpl }),
      );

      const status = buffer.appendStatus.mock.calls[0]?.[0].status ?? "";
      expect(status).toContain("busy");
    });
  });

  describe("given the manager stays at capacity", () => {
    it("gives up after a bounded number of goes", async () => {
      const buffer = makeBuffer();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse(['{"type":"error","error":"at-capacity"}']),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({ buffer: buffer as unknown as RunTurnDeps["buffer"], fetchImpl }),
      );

      // The first go plus three retries — then the honest error card.
      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(markedErrorKind(buffer)).toBe("langy_agent_at_capacity");
    });
  });

  describe("given the turn already streamed part of an answer", () => {
    it("does NOT replay it — that would duplicate the prose and any side effect", async () => {
      // The agent has no idempotency key: a replayed turn can open a SECOND PR.
      // And the tokens below are already in the durable buffer and on screen.
      const buffer = makeBuffer();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          '{"type":"message.part.delta","properties":{"field":"text","delta":"half an answer"}}',
          '{"type":"error","error":"at-capacity"}',
        ]),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({ buffer: buffer as unknown as RunTurnDeps["buffer"], fetchImpl }),
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(buffer.appendStatus).not.toHaveBeenCalled();
      expect(markedErrorKind(buffer)).toBe("langy_agent_at_capacity");
    });

    it("does NOT replay a turn that already ran a tool", async () => {
      const buffer = makeBuffer();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          '{"type":"langy.tool","id":"t","name":"create_prompt","phase":"start"}',
          '{"type":"error","error":"at-capacity"}',
        ]),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({ buffer: buffer as unknown as RunTurnDeps["buffer"], fetchImpl }),
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(markedErrorKind(buffer)).toBe("langy_agent_at_capacity");
    });
  });

  describe("given a failure the server cannot fix from inside itself", () => {
    it("hands a lost session straight to the client without retrying", async () => {
      const buffer = makeBuffer();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse(['{"type":"error","error":"session-not-found"}']),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({ buffer: buffer as unknown as RunTurnDeps["buffer"], fetchImpl }),
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(markedErrorKind(buffer)).toBe("langy_agent_session_lost");
    });

    it("never retries an unknown failure", async () => {
      const buffer = makeBuffer();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse(['{"type":"error","error":"something we cannot name"}']),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({ buffer: buffer as unknown as RunTurnDeps["buffer"], fetchImpl }),
      );

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(markedErrorKind(buffer)).toBe("unknown");
    });
  });
});

/**
 * The tool events a turn actually records.
 *
 * These pin the chain that was broken end to end: opencode announces `running`
 * with an input of `{}` and fills the command in on a re-send, and the emitter
 * used to open the card on that first empty frame and drop the re-send as a
 * duplicate. The command then reached the control plane on NO frame, so
 * `bash("langwatch trace search")` could not be re-typed into the capability it
 * was, and the durable log recorded "the agent ran bash" — a sentence that
 * answers nothing you would ever ask of an event log.
 *
 * The emitter's half is fixed in Go (opencode.go: the card opens on the frame
 * that KNOWS the command). This is the other half: given a frame that carries the
 * command, the turn must record what the call WAS and what it DID.
 */
describe("runTurn (tool events)", () => {
  const CMD = "langwatch trace search --format json";

  describe("given a bash call carrying a LangWatch CLI command", () => {
    it("records it as the capability it is, with the command, on both start and end", async () => {
      const conversations = makeConversations();
      const buffer = makeBuffer();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          JSON.stringify({
            type: "langy.tool",
            id: "call_1",
            name: "bash",
            phase: "start",
            input: { command: CMD },
          }),
          JSON.stringify({
            type: "langy.tool",
            id: "call_1",
            name: "bash",
            phase: "end",
            input: { command: CMD },
            output: '{"traces":[{"trace_id":"t_1"}]}',
            isError: false,
          }),
          JSON.stringify({ type: "text", text: "done" }),
        ]),
      );

      await runTurn(
        job(),
        deps({
          fetchImpl: fetchImpl as unknown as RunTurnDeps["fetchImpl"],
          conversations:
            conversations as unknown as RunTurnDeps["conversations"],
          buffer: buffer as unknown as RunTurnDeps["buffer"],
        }),
      );

      const started = conversations.recordToolCallStarted.mock.calls[0]?.[0]!;
      // Re-typed: the durable log says what the agent DID, not which binary it used.
      expect(started.toolName).toBe("langwatch.trace.search");
      expect(started.toolName).not.toBe("bash");
      // And it says WHICH one — the thing you would actually search the log for.
      expect(started.command).toBe(CMD);

      const completed =
        conversations.recordToolCallCompleted.mock.calls[0]?.[0]!;
      // The two halves of one call must not disagree about what it was.
      expect(completed.toolName).toBe("langwatch.trace.search");
      expect(completed.command).toBe(CMD);
      expect(typeof completed.durationMs).toBe("number");

      // The live card gets the command too — this is what it labels itself with.
      const startEntry = buffer.appendTool.mock.calls
        .map((c) => c[0]!)
        .find((e) => e.phase === "start");
      expect(startEntry?.name).toBe("langwatch.trace.search");
      expect(startEntry?.input?.command).toBe(CMD);
    });
  });

  describe("when the end frame arrives without the input", () => {
    it("still identifies the call, from the command seen on its start", async () => {
      const conversations = makeConversations();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          JSON.stringify({
            type: "langy.tool",
            id: "call_1",
            name: "bash",
            phase: "start",
            input: { command: CMD },
          }),
          // An older emitter closed the card with no input at all.
          JSON.stringify({
            type: "langy.tool",
            id: "call_1",
            name: "bash",
            phase: "end",
            output: "{}",
            isError: false,
          }),
        ]),
      );

      await runTurn(
        job(),
        deps({
          fetchImpl: fetchImpl as unknown as RunTurnDeps["fetchImpl"],
          conversations:
            conversations as unknown as RunTurnDeps["conversations"],
        }),
      );

      const completed =
        conversations.recordToolCallCompleted.mock.calls[0]?.[0]!;
      expect(completed.toolName).toBe("langwatch.trace.search");
      expect(completed.command).toBe(CMD);
    });
  });

  describe("when a tool call fails", () => {
    it("keeps the failure itself, not just a boolean", async () => {
      const conversations = makeConversations();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          JSON.stringify({
            type: "langy.tool",
            id: "call_1",
            name: "bash",
            phase: "start",
            input: { command: CMD },
          }),
          JSON.stringify({
            type: "langy.tool",
            id: "call_1",
            name: "bash",
            phase: "end",
            output: "permission denied: traces:read",
            isError: true,
          }),
        ]),
      );

      await runTurn(
        job(),
        deps({
          fetchImpl: fetchImpl as unknown as RunTurnDeps["fetchImpl"],
          conversations:
            conversations as unknown as RunTurnDeps["conversations"],
        }),
      );

      const completed =
        conversations.recordToolCallCompleted.mock.calls[0]?.[0]!;
      expect(completed.isError).toBe(true);
      // "It broke" is not debuggable. "Why it broke" is.
      expect(completed.errorText).toContain("permission denied");
    });
  });
});
