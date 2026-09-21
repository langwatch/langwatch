import { describe, expect, it } from "vitest";
import { ANSWERED_CARD_MESSAGE } from "./guided-turn-end.js";
import { TurnRunner, lastAssistantError, type SessionLike } from "./runner.js";
import { ANSWERED_CONTINUE_LINE } from "./tools/question.js";
import { createTurnContext, type TurnContext } from "./tools/turn-context.js";
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
  options?: {
    sessionResumed?: boolean;
    turnContext?: TurnContext;
    loadSkill?: (name: string) => string | undefined;
    warn?: (message: string) => void;
  };
}) {
  const { writer, events } = makeWriter();
  const runner = new TurnRunner({
    session,
    writer,
    composeSystem: (turnSystem?: string) => `PERSONA\n\nAGENTS${turnSystem ? `\n\n${turnSystem}` : ""}`,
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

/** Feed the runner one settled tool call, the way pi's session reports it. */
function settle(
  runner: TurnRunner,
  { id, name, input, output = "", isError = false }: { id: string; name: string; input: unknown; output?: string; isError?: boolean },
): void {
  runner.onSessionEvent({ type: "tool_execution_start", toolCallId: id, toolName: name, args: input });
  runner.onSessionEvent({
    type: "tool_execution_end",
    toolCallId: id,
    toolName: name,
    isError,
    result: { content: [{ type: "text", text: output }] },
  });
}

/** The kickoff turn ends on the code access card: feed that card so the turn ended as written. */
function endOnCard(runner: TurnRunner): void {
  settle(runner, { id: "card", name: "code_access", input: { reason: "wire tracing in" } });
}

const STEP2_LINES = {
  framework: "I found a LangGraph agent in app/graph.py.",
  branch: "I left branch langy/acme-checkout checked out: the agent you started runs on it.",
  pullRequest:
    "I opened a pull request with the tracing change: https://example.test/acme/pull/5. You can merge it already.",
};

/** A step 2 turn's calls up to the pull request line, with the branch line left unsaid. */
function feedStep2WithoutBranchLine(runner: TurnRunner): void {
  settle(runner, { id: "p1", name: "todowrite", input: { todos: [{ content: "The three step 2 lines said", status: "in_progress" }] } });
  settle(runner, { id: "s1", name: "say", input: { text: STEP2_LINES.framework }, output: "Said." });
  settle(runner, { id: "s2", name: "say", input: { text: STEP2_LINES.pullRequest }, output: "Said." });
  settle(runner, { id: "p2", name: "todowrite", input: { todos: [{ content: "The three step 2 lines said", status: "completed" }] } });
}

const GUIDED_HISTORY = [{ role: "user", content: "Guided onboarding kickoff.\nPath to set up now: llmops." }];

describe("TurnRunner", () => {
  describe("when the local tools need the turn they belong to", () => {
    it("names the turn in flight and names none once it ends", async () => {
      const fake = makeFakeSession();
      const turnContext = createTurnContext();
      const { runner } = makeRunner({ session: fake.session, options: { turnContext } });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "hi" });
      await until(() => fake.promptCalls.length === 1);
      expect(turnContext.turnId).toBe("t1");
      fake.finish();
      await done;
      expect(turnContext.turnId).toBeNull();
    });

    /** @scenario "The skill is refused outside a guided conversation" */
    it("says whether the conversation is on the guided path, and says no between turns", async () => {
      const fake = makeFakeSession();
      const turnContext = createTurnContext();
      const { runner } = makeRunner({ session: fake.session, options: { turnContext } });

      const plain = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "Go ahead." });
      await until(() => fake.promptCalls.length === 1);
      expect(turnContext.guided).toBe(false);
      fake.finish();
      await plain;

      const kickoff = runner.submitTurn({
        type: "turn",
        turnId: "t2",
        prompt: "Guided onboarding kickoff.\nPath to set up now: llmops.",
      });
      await until(() => fake.promptCalls.length === 2);
      expect(turnContext.guided).toBe(true);
      endOnCard(runner);
      fake.finish();
      await kickoff;
      expect(turnContext.guided).toBe(false);

      fake.session.agent.state.messages = GUIDED_HISTORY;
      const later = runner.submitTurn({ type: "turn", turnId: "t3", prompt: "Go ahead." });
      await until(() => fake.promptCalls.length === 3);
      expect(turnContext.guided).toBe(true);
      endOnCard(runner);
      fake.finish();
      await later;
    });
  });

  describe("when a resumed conversation reaches a fresh worker", () => {
    const SEED_WITH_KICKOFF = [
      "user: Guided onboarding kickoff.\nPath to set up now: llmops (Evals & LLM Ops).",
      "assistant: Hi Ada! Let's get Evals & LLM Ops set up.",
    ].join("\n");
    const SEED_PLAIN = "user: How do I add a trace?\nassistant: Install the SDK and call setup.";
    const SEED_WITH_CARD_ANSWERED = [
      SEED_WITH_KICKOFF,
      `assistant: [tool call: say ${JSON.stringify({ text: STEP2_LINES.framework })}]`,
      "toolResult(say): Said.",
      `assistant: [tool call: say ${JSON.stringify({ text: STEP2_LINES.branch })}]`,
      "toolResult(say): Said.",
      `assistant: [tool call: say ${JSON.stringify({ text: STEP2_LINES.pullRequest })}]`,
      "toolResult(say): Said.",
      'assistant: [tool call: question {"questions":[{"header":"Propose the first scenario"}]}]',
      `toolResult(question): A: Create it\n\n${ANSWERED_CONTINUE_LINE}`,
    ].join("\n");

    /** @scenario "A resumed guided conversation is guided on a fresh worker" */
    it("reads the turn as guided off the seed's kickoff, for the skill tool and the guard alike", async () => {
      const fake = makeFakeSession();
      const turnContext = createTurnContext();
      const { runner, events } = makeRunner({ session: fake.session, options: { turnContext } });
      const done = runner.submitTurn({
        type: "turn",
        turnId: "t1",
        prompt: "Go ahead, keep going.",
        resumeToken: SEED_WITH_KICKOFF,
      });
      await until(() => fake.promptCalls.length === 1);
      expect(fake.session.agent.state.messages).toEqual([]);
      expect(turnContext.guided).toBe(true);
      settle(runner, { id: "s1", name: "say", input: { text: "Continuing the setup." }, output: "Said." });
      fake.finish();
      await until(() => fake.promptCalls.length === 2);
      expect(events).toContainEqual({
        type: "guided_turn",
        turnId: "t1",
        event: "guided_turn_continued",
        segment: 1,
        missing: ["the next step"],
      });
      expect(turnContext.guided).toBe(true);
      endOnCard(runner);
      fake.finish();
      await done;
      expect(turnContext.guided).toBe(false);
    });

    /** @scenario "The continuation names what the history shows done and the step to continue from" */
    it("continues from the step the seed shows the path at, never from the top", async () => {
      const fake = makeFakeSession();
      const { runner } = makeRunner({ session: fake.session });
      // pi holds the composed prompt as the turn's user message once it went out.
      fake.session.prompt = async (text: string) => {
        fake.session.agent.state.messages.push({ role: "user", content: text });
      };
      await runner.submitTurn({
        type: "turn",
        turnId: "t1",
        prompt: "Go ahead, keep going.",
        resumeToken: SEED_WITH_CARD_ANSWERED,
      });
      const prompts = fake.session.agent.state.messages.map((message) => (message as { content: string }).content);
      expect(prompts[0]?.startsWith("[Resumed conversation")).toBe(true);
      expect(prompts[1]).toBe(
        "The path is not finished. The history shows: the three step 2 lines said and the first scenario card answered. Continue from step 4 (The checklist, then create, explain, run), through `langwatch onboarding complete-path` and the closing line.",
      );
      fake.session.agent.state.messages = [];
      await runner.submitTurn({
        type: "turn",
        turnId: "t2",
        prompt: "Go ahead, keep going.",
        resumeToken: SEED_WITH_KICKOFF,
      });
      expect((fake.session.agent.state.messages[1] as { content: string }).content).toBe(
        "The path is not finished. The history shows none of the path's steps done. Continue from step 2 (Read the code and wire it), through `langwatch onboarding complete-path` and the closing line.",
      );
    });

    it("reads a plain conversation as not guided, for the skill tool and the guard alike", async () => {
      const fake = makeFakeSession();
      const turnContext = createTurnContext();
      const { runner, events } = makeRunner({ session: fake.session, options: { turnContext } });
      const done = runner.submitTurn({
        type: "turn",
        turnId: "t1",
        prompt: "Go ahead, keep going.",
        resumeToken: SEED_PLAIN,
      });
      await until(() => fake.promptCalls.length === 1);
      expect(turnContext.guided).toBe(false);
      settle(runner, { id: "s1", name: "say", input: { text: "Sure." }, output: "Said." });
      fake.finish();
      await done;
      expect(fake.promptCalls).toHaveLength(1);
      expect(events.filter((event) => event.type === "guided_turn")).toEqual([]);
    });
  });

  describe("when a turn completes cleanly", () => {
    it("emits turn_started then turn_done ok, with the recomposed system prompt applied", async () => {
      const fake = makeFakeSession();
      const { runner, events } = makeRunner({ session: fake.session, appliedSystemPrompts: fake.appliedSystemPrompts });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "hi", system: "SYS" });
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

  describe("when a guided turn ends on none of the calls the skill allows", () => {
    /** @scenario "A guided turn that ends bare is continued once" */
    it("appends one continuation to the same turn, then ends the turn and reports the second bare end", async () => {
      const fake = makeFakeSession();
      fake.session.agent.state.messages = GUIDED_HISTORY;
      const { runner, events } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t2", prompt: "Local folder connected" });
      await until(() => fake.promptCalls.length === 1);
      feedStep2WithoutBranchLine(runner);
      fake.finish();
      await until(() => fake.promptCalls.length === 2);
      expect(fake.promptCalls[1]?.prompt).toBe(
        "Step 2 is not finished: the branch line was not said, and the first scenario card was not asked. Say the missing line, then continue with step 3 and end on the question card.",
      );
      expect(events).toContainEqual({
        type: "guided_turn",
        turnId: "t2",
        event: "guided_turn_continued",
        segment: 1,
        missing: ["the branch line", "the first scenario card"],
      });
      expect(events.some((event) => event.type === "turn_done")).toBe(false);
      fake.finish();
      await done;
      expect(fake.promptCalls).toHaveLength(2);
      // The report lands on the protocol ahead of the terminal.
      expect(events.slice(-2)).toEqual([
        {
          type: "guided_turn",
          turnId: "t2",
          event: "guided_turn_bare_end",
          segment: 1,
          missing: ["the branch line", "the first scenario card"],
        },
        { type: "turn_done", turnId: "t2", outcome: "ok" },
      ]);
    });

    /** @scenario "The continuation names the step 2 lines the turn did not say" */
    it("continues with only the card named once the missing line was said on the second pass, and stops there", async () => {
      const fake = makeFakeSession();
      fake.session.agent.state.messages = GUIDED_HISTORY;
      const { runner, events } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t2", prompt: "Local folder connected" });
      await until(() => fake.promptCalls.length === 1);
      feedStep2WithoutBranchLine(runner);
      fake.finish();
      await until(() => fake.promptCalls.length === 2);
      settle(runner, { id: "s3", name: "say", input: { text: STEP2_LINES.branch }, output: "Said." });
      fake.finish();
      await done;
      expect(fake.promptCalls).toHaveLength(2);
      expect(events).toContainEqual({
        type: "guided_turn",
        turnId: "t2",
        event: "guided_turn_bare_end",
        segment: 1,
        missing: ["the first scenario card"],
      });
    });

    /** @scenario "An answered card is not an ending" */
    it("continues after a card answered inside the turn, with a continuation of that segment's own", async () => {
      const fake = makeFakeSession();
      fake.session.agent.state.messages = GUIDED_HISTORY;
      const { runner, events } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t2", prompt: "Local folder connected" });
      await until(() => fake.promptCalls.length === 1);
      feedStep2WithoutBranchLine(runner);
      fake.finish();
      // The first segment's one continuation is spent here.
      await until(() => fake.promptCalls.length === 2);
      settle(runner, { id: "s3", name: "say", input: { text: STEP2_LINES.branch }, output: "Said." });
      settle(runner, {
        id: "q1",
        name: "question",
        input: { questions: [{ header: "Propose the first scenario" }] },
        output: `Q: The proposal\nA: Create it\n\n${ANSWERED_CONTINUE_LINE}`,
      });
      // The turn stops right on the answered card.
      fake.finish();
      await until(() => fake.promptCalls.length === 3);
      expect(fake.promptCalls[2]?.prompt).toBe(ANSWERED_CARD_MESSAGE);
      expect(events).toContainEqual({
        type: "guided_turn",
        turnId: "t2",
        event: "guided_turn_continued",
        segment: 2,
        missing: ["the work that follows the answer"],
      });
      // Bare again in the second segment: reported with the segment, and left.
      settle(runner, { id: "s4", name: "say", input: { text: "Running it against your agent now." }, output: "Said." });
      fake.finish();
      await done;
      expect(fake.promptCalls).toHaveLength(3);
      expect(events.slice(-2)).toEqual([
        {
          type: "guided_turn",
          turnId: "t2",
          event: "guided_turn_bare_end",
          segment: 2,
          missing: ["the work that follows the answer"],
        },
        { type: "turn_done", turnId: "t2", outcome: "ok" },
      ]);
    });

    /** @scenario "A turn that ended on a card, a closing line or a failed step is left alone" */
    it("leaves a turn that ended on the question card alone", async () => {
      const fake = makeFakeSession();
      fake.session.agent.state.messages = GUIDED_HISTORY;
      const { runner, events } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t2", prompt: "Local folder connected" });
      await until(() => fake.promptCalls.length === 1);
      feedStep2WithoutBranchLine(runner);
      settle(runner, { id: "s3", name: "say", input: { text: STEP2_LINES.branch }, output: "Said." });
      settle(runner, { id: "q1", name: "question", input: { questions: [{ header: "Create the first scenario" }] } });
      fake.finish();
      await done;
      expect(fake.promptCalls).toHaveLength(1);
      expect(events.filter((event) => event.type === "guided_turn")).toEqual([]);
      expect(events[events.length - 1]).toEqual({ type: "turn_done", turnId: "t2", outcome: "ok" });
    });

    it("leaves a turn outside the guided path alone", async () => {
      const fake = makeFakeSession();
      const { runner } = makeRunner({ session: fake.session });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "How do I add a trace?" });
      await until(() => fake.promptCalls.length === 1);
      settle(runner, { id: "s1", name: "say", input: { text: "Like this." }, output: "Said." });
      fake.finish();
      await done;
      expect(fake.promptCalls).toHaveLength(1);
    });

    /** @scenario "A message from the user cancels the continuation" */
    it("does not continue a turn the user has already moved past", async () => {
      const fake = makeFakeSession();
      fake.session.agent.state.messages = GUIDED_HISTORY;
      const { runner, events } = makeRunner({ session: fake.session });
      const first = runner.submitTurn({ type: "turn", turnId: "t2", prompt: "Local folder connected" });
      await until(() => fake.promptCalls.length === 1);
      feedStep2WithoutBranchLine(runner);
      fake.finish();
      const second = runner.submitTurn({ type: "turn", turnId: "t3", prompt: "Actually, use the other folder." });
      await first;
      await until(() => fake.promptCalls.length === 2);
      expect(fake.promptCalls[1]?.prompt).toBe("Actually, use the other folder.");
      expect(events.filter((event) => event.type === "guided_turn")).toEqual([]);
      // The newer turn ends on the card, as written.
      settle(runner, { id: "q1", name: "question", input: { questions: [] } });
      fake.finish();
      await second;
      expect(events.filter((event) => event.type === "turn_done").map((event) => event.turnId)).toEqual(["t2", "t3"]);
    });
  });

  describe("when the turn is a guided onboarding kickoff", () => {
    const KICKOFF = "Guided onboarding kickoff.\nPath to set up now: coding (Coding Agent Tracking).\nTour: completed.";
    const SKILL = "---\nname: guided-onboarding\n---\n\n# Guided onboarding\n\nSay the two lines.";

    /** @scenario "The worker places the skill ahead of the kickoff brief" */
    it("prepends the guided-onboarding skill's body, then the brief", async () => {
      const fake = makeFakeSession();
      const loaded: string[] = [];
      const { runner } = makeRunner({
        session: fake.session,
        options: {
          loadSkill: (name) => {
            loaded.push(name);
            return SKILL;
          },
        },
      });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: KICKOFF });
      await until(() => fake.promptCalls.length === 1);
      endOnCard(runner);
      fake.finish();
      await done;
      expect(loaded).toEqual(["guided-onboarding"]);
      const prompt = fake.promptCalls[0]?.prompt ?? "";
      expect(prompt.startsWith('[Skill "guided-onboarding"')).toBe(true);
      expect(prompt.indexOf("Say the two lines.")).toBeLessThan(prompt.indexOf("Guided onboarding kickoff."));
      expect(prompt.endsWith(KICKOFF)).toBe(true);
    });

    it("places a handoff digest ahead of the skill when the turn resumes one", async () => {
      const fake = makeFakeSession();
      const { runner } = makeRunner({
        session: fake.session,
        options: { loadSkill: () => SKILL },
      });
      const done = runner.submitTurn({
        type: "turn",
        turnId: "t1",
        prompt: KICKOFF,
        resumeToken: "user: earlier",
      });
      await until(() => fake.promptCalls.length === 1);
      endOnCard(runner);
      fake.finish();
      await done;
      const prompt = fake.promptCalls[0]?.prompt ?? "";
      expect(prompt.startsWith("[Resumed conversation")).toBe(true);
      expect(prompt.indexOf("user: earlier")).toBeLessThan(prompt.indexOf('[Skill "guided-onboarding"'));
      expect(prompt.endsWith(KICKOFF)).toBe(true);
    });

    /** @scenario "A kickoff without the skill installed runs on the routing row alone" */
    it("passes the brief through and warns when the skill is not installed", async () => {
      const fake = makeFakeSession();
      const warnings: string[] = [];
      const { runner } = makeRunner({
        session: fake.session,
        options: { loadSkill: () => undefined, warn: (message) => warnings.push(message) },
      });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: KICKOFF });
      await until(() => fake.promptCalls.length === 1);
      endOnCard(runner);
      fake.finish();
      await done;
      expect(fake.promptCalls[0]?.prompt).toBe(KICKOFF);
      expect(warnings.join("\n")).toContain('skill "guided-onboarding" is not installed');
    });

    it("leaves an ordinary message alone and loads nothing", async () => {
      const fake = makeFakeSession();
      const loaded: string[] = [];
      const { runner } = makeRunner({
        session: fake.session,
        options: {
          loadSkill: (name) => {
            loaded.push(name);
            return SKILL;
          },
        },
      });
      const done = runner.submitTurn({ type: "turn", turnId: "t1", prompt: "show me traces" });
      await until(() => fake.promptCalls.length === 1);
      fake.finish();
      await done;
      expect(loaded).toEqual([]);
      expect(fake.promptCalls[0]?.prompt).toBe("show me traces");
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
      const { runner } = makeRunner({ session: fake.session, options: { sessionResumed: true } });
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
      expect(events.at(-1)).toEqual({ type: "turn_done", turnId: "t1", outcome: "aborted" });
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
