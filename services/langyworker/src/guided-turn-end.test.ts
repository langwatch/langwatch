/**
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMPLETE_PATH_COMMAND,
  FRAMEWORK_LINE_SHAPE,
  STEP2_LINE_TEMPLATES,
  STEP2_LINES_ITEM,
  TurnCallLog,
  decideGuidedContinuation,
  guidedTurnEnding,
  historyHasGuidedKickoff,
  missingStep2Lines,
  templatePattern,
  type TurnCall,
} from "./guided-turn-end.js";

const FRAMEWORK = "I found a LangGraph agent in app/graph.py.";
const BRANCH = "I left branch langy/acme-checkout checked out: the agent you started runs on it.";
const PULL_REQUEST =
  "I opened a pull request with the tracing change: https://example.test/acme/pull/5. You can merge it already.";
const NO_REMOTE =
  "No pull request was opened, since the folder has no remote or gh is not signed in: branch langy/acme-checkout holds the commit.";

const STEP2_ITEMS = [
  "Read the code and name the framework",
  "The langy branch checked out",
  STEP2_LINES_ITEM,
];

function call(name: string, input: unknown, over: Partial<TurnCall> = {}): TurnCall {
  return { name, input, isError: false, output: "", ...over };
}

const say = (text: string) => call("say", { text }, { output: "Said." });
const plan = (status: string) =>
  call("todowrite", { todos: STEP2_ITEMS.map((content) => ({ content, status })) });
const shell = (command: string, exitCode = 0) =>
  call("local_bash", { command }, { output: `exit code: ${exitCode}\n\nstdout:\n` });
const question = () => call("question", { questions: [{ header: "Create the first scenario" }] });

describe("the guided turn end guard", () => {
  describe("when the turn ended on a card, a closing line or a failed step", () => {
    /** @scenario "A turn that ended on a card, a closing line or a failed step is left alone" */
    it("leaves the turn alone, and names what it ended on", () => {
      const lines = [plan("completed"), say(FRAMEWORK), say(BRANCH), say(PULL_REQUEST)];
      expect(guidedTurnEnding([...lines, question()])).toBe("card");
      expect(guidedTurnEnding([call("code_access", { reason: "wire tracing in" })])).toBe("card");
      expect(
        guidedTurnEnding([
          shell(`${COMPLETE_PATH_COMMAND} llmops`),
          say("All ready! Let me know if there is anything I can help with."),
        ]),
      ).toBe("closing_line");
      expect(
        guidedTurnEnding([
          shell('langwatch agent list --wait-online "acme-checkout" --format json', 1),
          say("The agent is not online after two minutes: the wait timed out."),
        ]),
      ).toBe("failed_step");
      expect(
        decideGuidedContinuation({ calls: [...lines, question()], guided: true, continuations: 0 }),
      ).toEqual({ kind: "leave", reason: "card" });
      expect(
        decideGuidedContinuation({
          calls: [shell(`${COMPLETE_PATH_COMMAND} coding`), say("All set.")],
          guided: true,
          continuations: 0,
        }),
      ).toEqual({ kind: "leave", reason: "closing_line" });
      expect(
        decideGuidedContinuation({
          calls: [plan("in_progress"), shell("uv add langwatch", 1), say("The install failed: no uv.")],
          guided: true,
          continuations: 0,
        }),
      ).toEqual({ kind: "leave", reason: "failed_step" });
    });

    it("never continues a turn outside the guided path", () => {
      expect(
        decideGuidedContinuation({ calls: [say("Here is what I found.")], guided: false, continuations: 0 }),
      ).toEqual({ kind: "leave", reason: "not_guided" });
    });
  });

  describe("when a guided turn ends bare", () => {
    /** @scenario "A guided turn that ends bare is continued once" */
    it("continues once with a message, and gives up on the second bare end", () => {
      const calls = [plan("completed"), say(FRAMEWORK), say(BRANCH), say(PULL_REQUEST), plan("completed")];
      expect(guidedTurnEnding(calls)).toBe("bare");
      const first = decideGuidedContinuation({ calls, guided: true, continuations: 0 });
      expect(first).toEqual({
        kind: "continue",
        missing: ["the first scenario card"],
        message:
          "Step 2 is finished but step 3 never started: the first scenario card was not asked. Continue with step 3 and end on the question card.",
      });
      expect(decideGuidedContinuation({ calls, guided: true, continuations: 1 })).toEqual({
        kind: "give_up",
        missing: ["the first scenario card"],
      });
    });

    it("names the next step on a turn that is not step 2", () => {
      const calls = [shell("langwatch scenario run scenario_1 --wait --format json"), say("Two things.")];
      expect(decideGuidedContinuation({ calls, guided: true, continuations: 0 })).toEqual({
        kind: "continue",
        missing: ["the next step"],
        message:
          "The path is not finished. Continue with the next step of the guided onboarding skill; end on the question card or the closing line.",
      });
    });
  });

  describe("when a step 2 turn ends with lines unsaid", () => {
    /** @scenario "The continuation names the step 2 lines the turn did not say" */
    it("names the missing line and the card, and only the card when every line was said", () => {
      // The r40 turn: the framework line, the pull request line, the plan all
      // done, and the branch line never said.
      const r40 = [say(FRAMEWORK), plan("in_progress"), say(PULL_REQUEST), plan("completed"), plan("completed")];
      expect(missingStep2Lines(r40)).toEqual(["the branch line"]);
      expect(decideGuidedContinuation({ calls: r40, guided: true, continuations: 0 })).toEqual({
        kind: "continue",
        missing: ["the branch line", "the first scenario card"],
        message:
          "Step 2 is not finished: the branch line was not said, and the first scenario card was not asked. Say the missing line, then continue with step 3 and end on the question card.",
      });

      const twoMissing = [plan("completed"), say(PULL_REQUEST)];
      expect(decideGuidedContinuation({ calls: twoMissing, guided: true, continuations: 0 })).toMatchObject({
        kind: "continue",
        message:
          "Step 2 is not finished: the framework line and the branch line were not said, and the first scenario card was not asked. Say the missing lines, then continue with step 3 and end on the question card.",
      });

      const allLines = [plan("completed"), say(FRAMEWORK), say(BRANCH), say(NO_REMOTE)];
      expect(missingStep2Lines(allLines)).toEqual([]);
      expect(decideGuidedContinuation({ calls: allLines, guided: true, continuations: 0 })).toMatchObject({
        kind: "continue",
        missing: ["the first scenario card"],
      });

      expect(
        decideGuidedContinuation({ calls: [...allLines, question()], guided: true, continuations: 0 }),
      ).toEqual({ kind: "leave", reason: "card" });
    });

    it("reads a turn as step 2 from the wait command when the plan was never written", () => {
      const calls = [shell('langwatch agent list --wait-online "acme" --format json'), say(PULL_REQUEST)];
      expect(decideGuidedContinuation({ calls, guided: true, continuations: 0 })).toMatchObject({
        missing: ["the framework line", "the branch line", "the first scenario card"],
      });
    });
  });

  describe("given the skill source", () => {
    const skill = readFileSync(
      fileURLToPath(new URL("../../../skills/guided-onboarding/SKILL.mdx", import.meta.url)),
      "utf8",
    );

    /** @scenario "The step 2 lines the guard checks are the skill's own" */
    it("carries every template, the framework shape, the checklist item and the closing command word for word", () => {
      for (const template of Object.values(STEP2_LINE_TEMPLATES)) {
        expect(skill).toContain(template);
      }
      expect(skill).toContain(FRAMEWORK_LINE_SHAPE);
      expect(skill).toContain(`11. ${STEP2_LINES_ITEM}`);
      expect(skill).toContain(`${COMPLETE_PATH_COMMAND} <path>`);
    });

    it("matches a line with its braces filled and nothing else", () => {
      const branch = templatePattern(STEP2_LINE_TEMPLATES.branch);
      expect(branch.test(BRANCH)).toBe(true);
      expect(branch.test("I left the branch checked out.")).toBe(false);
      expect(branch.test(`${BRANCH} Next I will write a scenario.`)).toBe(false);
    });
  });

  describe("given pi's session events", () => {
    it("records each settled call with the input its start carried", () => {
      const log = new TurnCallLog();
      log.record({ type: "tool_execution_start", toolCallId: "c1", toolName: "Say", args: { text: FRAMEWORK } });
      log.record({ type: "tool_execution_update", toolCallId: "c1", toolName: "Say" });
      log.record({
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "Say",
        isError: false,
        result: { content: [{ type: "text", text: "Said." }] },
      });
      expect(log.calls).toEqual([{ name: "say", input: { text: FRAMEWORK }, isError: false, output: "Said." }]);
    });

    it("reads the guided path off a kickoff brief in the history", () => {
      expect(historyHasGuidedKickoff([{ role: "user", content: "Guided onboarding kickoff.\nPath: llmops." }])).toBe(true);
      expect(
        historyHasGuidedKickoff([
          { role: "user", content: [{ type: "text", text: '[Skill "guided-onboarding"]\nGuided onboarding kickoff.' }] },
        ]),
      ).toBe(true);
      expect(historyHasGuidedKickoff([{ role: "assistant", content: "Guided onboarding kickoff." }])).toBe(false);
      expect(historyHasGuidedKickoff([{ role: "user", content: "How do I add a trace?" }])).toBe(false);
    });
  });
});
