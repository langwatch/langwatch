import { describe, expect, it } from "vitest";
import { TurnRunner, lastAssistantError, type SessionLike } from "./runner.js";
import { ProtocolWriter } from "./writer.js";

type Emitted = Record<string, unknown>;

function makeWriter() {
  const events: Emitted[] = [];
  const writer = new ProtocolWriter((chunk, callback) => {
    events.push(JSON.parse(chunk) as Emitted);
    callback();
    return true;
  });
  return { writer, events };
}

/**
 * A fake pi session: each prompt() call blocks until the test releases it (or
 * abort() is called), and records the system prompt it saw.
 */
function makeFakeSession() {
  let release: (() => void) | undefined;
  let rejectRun: ((error: Error) => void) | undefined;
  const promptCalls: Array<{ prompt: string; systemPrompt: string }> = [];
  let abortCount = 0;
  const appliedSystemPrompts: string[] = [];
  const session: SessionLike = {
    agent: { state: { messages: [] as unknown[] } },
    prompt: (text: string) =>
      new Promise<void>((resolve, reject) => {
        promptCalls.push({
          prompt: text,
          systemPrompt: appliedSystemPrompts[appliedSystemPrompts.length - 1] ?? "",
        });
        release = resolve;
        rejectRun = reject;
      }),
    abort: async () => {
      release?.();
      release = undefined;
    },
  };
  return {
    session,
    promptCalls,
    appliedSystemPrompts,
    finish: () => {
      release?.();
      release = undefined;
    },
    fail: (message: string) => {
      rejectRun?.(new Error(message));
      rejectRun = undefined;
    },
    abortCount: () => abortCount,
    trackAborts: () => {
      const original = session.abort;
      session.abort = async () => {
        abortCount++;
        await original();
      };
    },
  };
}

function makeRunner({
  session,
  appliedSystemPrompts = [],
  options = {},
}: {
  session: SessionLike;
  appliedSystemPrompts?: string[];
  options?: { sessionResumed?: boolean };
}) {
  const { writer, events } = makeWriter();
  const runner = new TurnRunner({
    session,
    writer,
    composeSystem: (turnSystem?: string) =>
      `PERSONA\n\nAGENTS${turnSystem ? `\n\n${turnSystem}` : ""}`,
    applySystemPrompt: (composed) => appliedSystemPrompts.push(composed),
    warn: () => undefined,
    ...options,
  });
  return { runner, events, writer };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(condition()).toBe(true);
}

describe("TurnRunner", () => {
  describe("when a turn completes cleanly", () => {
    it("emits turn_started then turn_done ok, with the recomposed system prompt applied", async () => {
      const fake = makeFakeSession();
      const { runner, events } = makeRunner({
        session: fake.session,
        appliedSystemPrompts: fake.appliedSystemPrompts,
      });
      const done = runner.submitTurn({
        type: "turn",
        turnId: "t1",
        prompt: "hi",
        system: "SYS",
      });
      await until(() => fake.promptCalls.length === 1);
      fake.finish();
      await done;
      expect(events).toEqual([
        { type: "turn_started", turnId: "t1" },
        { type: "turn_done", turnId: "t1", outcome: "ok" },
      ]);
      expect(fake.promptCalls[0]?.systemPrompt).toBe("PERSONA\n\nAGENTS\n\nSYS");
      expect(fake.promptCalls[0]?.prompt).toBe("hi");
    });
  });

  describe("when the turn carries a resumeToken", () => {
    it("prepends the labeled seed to the prompt", async () => {
      const fake = makeFakeSession();
      const { runner } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({
        type: "turn",
        turnId: "t1",
        prompt: "continue",
        resumeToken: "user: earlier",
      });
      await until(() => fake.promptCalls.length === 1);
      fake.finish();
      await done;
      expect(fake.promptCalls[0]?.prompt).toContain("[Resumed conversation");
      expect(fake.promptCalls[0]?.prompt).toContain("user: earlier");
      expect(fake.promptCalls[0]?.prompt.endsWith("continue")).toBe(true);
    });
  });

  describe("when the session was resumed from the home's own transcript", () => {
    /** @scenario A resumed session ignores the handoff digest it no longer needs */
    it("does not prepend the resumeToken seed", async () => {
      const fake = makeFakeSession();
      const { runner } = makeRunner({
        session: fake.session,
        options: { sessionResumed: true },
      });
      const done = runner.submitTurn({
        type: "turn",
        turnId: "t1",
        prompt: "continue",
        resumeToken: "user: earlier",
      });
      await until(() => fake.promptCalls.length === 1);
      fake.finish();
      await done;
      expect(fake.promptCalls[0]?.prompt).toBe("continue");
    });
  });

  describe("when prompt() rejects", () => {
    it("terminates with turn_done error carrying the message", async () => {
      const fake = makeFakeSession();
      const { runner, events } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "hi" });
      await until(() => fake.promptCalls.length === 1);
      fake.fail("provider exploded");
      await done;
      expect(events.at(-1)).toEqual({
        type: "turn_done",
        turnId: "t1",
        outcome: "error",
        errorMessage: "provider exploded",
      });
    });
  });

  describe("when the last assistant message carries a provider error", () => {
    it("maps a resolved prompt to turn_done error (the harness-pi rule)", async () => {
      const fake = makeFakeSession();
      const { runner, events } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "hi" });
      await until(() => fake.promptCalls.length === 1);
      fake.session.agent.state.messages.push({
        role: "assistant",
        stopReason: "error",
        errorMessage: "429 rate limited",
      });
      fake.finish();
      await done;
      expect(events.at(-1)).toEqual({
        type: "turn_done",
        turnId: "t1",
        outcome: "error",
        errorMessage: "429 rate limited",
      });
    });
  });

  describe("when abort arrives for the running turn", () => {
    it("aborts the session and terminates with outcome aborted", async () => {
      const fake = makeFakeSession();
      fake.trackAborts();
      const { runner, events } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "hi" });
      await until(() => fake.promptCalls.length === 1);
      runner.abortTurn("t1");
      await done;
      expect(fake.abortCount()).toBe(1);
      expect(events.at(-1)).toEqual({
        type: "turn_done",
        turnId: "t1",
        outcome: "aborted",
      });
    });
  });

  describe("when abort names a stale turnId", () => {
    it("is ignored and the turn finishes ok", async () => {
      const fake = makeFakeSession();
      fake.trackAborts();
      const { runner, events } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "hi" });
      await until(() => fake.promptCalls.length === 1);
      runner.abortTurn("t-other");
      fake.finish();
      await done;
      expect(fake.abortCount()).toBe(0);
      expect(events.at(-1)).toEqual({ type: "turn_done", turnId: "t1", outcome: "ok" });
    });
  });

  describe("when a new turn arrives while one runs", () => {
    it("aborts the running turn; its aborted terminal lands before the new turn_started", async () => {
      const fake = makeFakeSession();
      const { runner, events } = makeRunner({ session: fake.session });
      void runner.submitTurn({ type: "turn", turnId: "t1", prompt: "one" });
      await until(() => fake.promptCalls.length === 1);
      const second = runner.submitTurn({ type: "turn", turnId: "t2", prompt: "two" });
      await until(() => fake.promptCalls.length === 2);
      fake.finish(); // finishes t2's prompt (t1 was released by abort)
      await second;
      expect(events.map((e) => [e.type, e.turnId])).toEqual([
        ["turn_started", "t1"],
        ["turn_done", "t1"],
        ["turn_started", "t2"],
        ["turn_done", "t2"],
      ]);
      expect(events[1]).toMatchObject({ outcome: "aborted" });
      expect(events[3]).toMatchObject({ outcome: "ok" });
    });
  });

  describe("when a second turn arrives before the first ever starts", () => {
    it("the first still gets its turn_started + aborted terminal pair, without prompting", async () => {
      const fake = makeFakeSession();
      const { runner, events } = makeRunner({ session: fake.session });
      void runner.submitTurn({ type: "turn", turnId: "t1", prompt: "one" });
      const second = runner.submitTurn({ type: "turn", turnId: "t2", prompt: "two" });
      await until(() => fake.promptCalls.length === 1);
      fake.finish();
      await second;
      expect(fake.promptCalls.map((c) => c.prompt)).toEqual(["two"]);
      expect(events.map((e) => [e.type, e.turnId])).toEqual([
        ["turn_started", "t1"],
        ["turn_done", "t1"],
        ["turn_started", "t2"],
        ["turn_done", "t2"],
      ]);
      expect(events[1]).toMatchObject({ outcome: "aborted" });
      expect(events[3]).toMatchObject({ outcome: "ok" });
    });
  });

  describe("when shutdown_imminent arrives mid-turn", () => {
    it("terminates the turn with a handoff digest of the conversation", async () => {
      const fake = makeFakeSession();
      const { runner, events } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "hi" });
      await until(() => fake.promptCalls.length === 1);
      fake.session.agent.state.messages.push(
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "text", text: "working on it" }] },
      );
      runner.shutdownImminent();
      await done;
      const terminal = events.at(-1) as { type: string; seed: string };
      expect(terminal.type).toBe("handoff");
      expect(terminal.seed).toContain("user: hi");
      expect(terminal.seed).toContain("assistant: working on it");
      // Nothing after the terminal for this turn.
      expect(events.filter((e) => e.turnId === "t1").at(-1)).toBe(terminal);
    });
  });

  describe("when shutdown_imminent arrives while idle", () => {
    it("is a no-op", async () => {
      const fake = makeFakeSession();
      const { runner, events } = makeRunner({ session: fake.session });
      runner.shutdownImminent();
      await runner.settled();
      expect(events).toEqual([]);
    });
  });

  describe("when session events arrive outside any turn", () => {
    it("drops them (terminal-last invariant)", async () => {
      const fake = makeFakeSession();
      const { runner, events, writer } = makeRunner({ session: fake.session });
      runner.onSessionEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "stray" },
      });
      await writer.flush();
      expect(events).toEqual([]);
    });
  });

  describe("when session events arrive during a turn", () => {
    it("forwards them tagged with the turnId, before the terminal", async () => {
      const fake = makeFakeSession();
      const { runner, events } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "hi" });
      await until(() => fake.promptCalls.length === 1);
      runner.onSessionEvent({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Hello" },
      });
      fake.finish();
      await done;
      expect(events.map((e) => e.type)).toEqual(["turn_started", "delta", "turn_done"]);
      expect(events[1]).toEqual({ type: "delta", turnId: "t1", text: "Hello" });
    });
  });
});

describe("lastAssistantError", () => {
  it("reads the last assistant message only", () => {
    expect(
      lastAssistantError([
        { role: "assistant", stopReason: "error", errorMessage: "old" },
        { role: "assistant", stopReason: "stop" },
      ]),
    ).toBeUndefined();
    expect(
      lastAssistantError([
        { role: "user" },
        { role: "assistant", stopReason: "error", errorMessage: "boom" },
        { role: "toolResult" },
      ]),
    ).toEqual({ kind: "error", message: "boom" });
    expect(lastAssistantError([{ role: "assistant", stopReason: "aborted" }])).toEqual({
      kind: "aborted",
      message: "aborted",
    });
    expect(lastAssistantError([])).toBeUndefined();
  });
});
