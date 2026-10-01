/**
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ANSWERED_CARD_MESSAGE,
  CLOSING_LINE,
  CLOSING_LINE_PUSHBACK,
  closingLineRefusal,
  COMPLETE_PATH_COMMAND,
  completePathRan,
  FRAMEWORK_LINE_SHAPE,
  LLMOPS_STEP_TITLES,
  MAX_TURN_CONTINUATIONS,
  STEP2_LINE_TEMPLATES,
  STEP2_LINES_ITEM,
  TRANSPARENT_TOOL_NAMES,
  TurnCallLog,
  decideGuidedContinuation,
  guidedSegment,
  guidedTurnEnding,
  guidedPathInHistory,
  missingStep2Lines,
  progressMessage,
  readGuidedProgress,
  templatePattern,
  type TurnCall,
} from "./guided-turn-end.js";
import { ANSWERED_CONTINUE_LINE } from "./tools/question.js";

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
const answered = () =>
  call(
    "question",
    { questions: [{ header: "Propose the first scenario" }] },
    {
      output: `Q: The proposal\nA: Create "Guest completes checkout" as your first scenario test\n\n${ANSWERED_CONTINUE_LINE}`,
    },
  );

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
          calls: [
            plan("in_progress"),
            shell("uv add langwatch", 1),
            say("The install failed: no uv."),
          ],
          guided: true,
          continuations: 0,
        }),
      ).toEqual({ kind: "leave", reason: "failed_step" });
    });

    it("never continues a turn outside the guided path", () => {
      expect(
        decideGuidedContinuation({
          calls: [say("Here is what I found.")],
          guided: false,
          continuations: 0,
        }),
      ).toEqual({ kind: "leave", reason: "not_guided" });
    });
  });

  describe("when the turn ends on calls that say nothing", () => {
    const navigate = (id: string, tool = "bash") =>
      call(tool, { command: `langwatch navigate open ${id}`, timeout: 30 });
    const closing = say("All ready! Let me know if there is anything I can help with.");

    /** @scenario "Calls that say nothing are transparent to the ender" */
    it("reads through navigates and lookups to the closing line, and names the calls it reads through", () => {
      // The t1 turn as the panel's record orders it: complete-path, the
      // closing line, then the two navigates.
      const t1 = [
        shell(`${COMPLETE_PATH_COMMAND} llmops`),
        closing,
        navigate("scenario_1"),
        navigate("scenariorun_1", "local_bash"),
      ];
      expect(guidedTurnEnding(t1)).toBe("closing_line");
      expect(decideGuidedContinuation({ calls: t1, guided: true, continuations: 0 })).toEqual({
        kind: "leave",
        reason: "closing_line",
      });
      expect(
        guidedTurnEnding([
          shell(`${COMPLETE_PATH_COMMAND} llmops`),
          navigate("scenariorun_1"),
          closing,
        ]),
      ).toBe("closing_line");
      expect(
        guidedTurnEnding([
          question(),
          call("local_read", { path: "app/graph.py" }),
          call("skill", { name: "tracing" }),
        ]),
      ).toBe("card");

      // A line that is not the closing line, followed by the same calls, still ends bare.
      const bare = [
        shell("langwatch scenario run scenario_1 --wait --format json"),
        say("Two things."),
        navigate("scenariorun_1"),
      ];
      expect(guidedTurnEnding(bare)).toBe("bare");
      // A file write is not read through: the turn ended on it.
      expect(guidedTurnEnding([...t1, call("local_edit", { path: "app/graph.py" })])).toBe("bare");

      expect([...TRANSPARENT_TOOL_NAMES].toSorted()).toEqual([
        "find",
        "grep",
        "local_find",
        "local_grep",
        "local_langwatch_env",
        "local_ls",
        "local_read",
        "ls",
        "read",
        "skill",
        "todowrite",
      ]);
    });
  });

  describe("when a guided turn ends bare", () => {
    /** @scenario "A guided turn that ends bare is continued once" */
    it("continues once with a message, and gives up on the second bare end", () => {
      const calls = [
        plan("completed"),
        say(FRAMEWORK),
        say(BRANCH),
        say(PULL_REQUEST),
        plan("completed"),
      ];
      expect(guidedTurnEnding(calls)).toBe("bare");
      const first = decideGuidedContinuation({ calls, guided: true, continuations: 0 });
      expect(first).toEqual({
        kind: "continue",
        segment: 1,
        missing: ["the first scenario card"],
        message:
          "Step 2 is finished but step 3 never started: the first scenario card was not asked. Continue with step 3 and end on the question card.",
      });
      expect(decideGuidedContinuation({ calls, guided: true, continuations: 1 })).toEqual({
        kind: "give_up",
        segment: 1,
        missing: ["the first scenario card"],
      });
    });

    it("names the next step on a turn that is not step 2", () => {
      const calls = [
        shell("langwatch scenario run scenario_1 --wait --format json"),
        say("Two things."),
      ];
      expect(decideGuidedContinuation({ calls, guided: true, continuations: 0 })).toEqual({
        kind: "continue",
        segment: 1,
        missing: ["the next step"],
        message:
          "The path is not finished. Continue with the next step of the guided onboarding skill; end on the question card or the closing line.",
      });
    });
  });

  describe("when the history shows how far the llmops path got", () => {
    const KICKOFF = {
      role: "user",
      content:
        "Guided onboarding kickoff.\nPath to set up now: llmops (Evals & LLM Ops).\nTour: completed.",
    };
    const step2 = [plan("completed"), say(FRAMEWORK), say(BRANCH), say(PULL_REQUEST)];

    /** @scenario "The continuation names what the history shows done and the step to continue from" */
    it("lists what is done and names the step to continue from, by the skill's numbering", () => {
      expect(readGuidedProgress([])).toEqual({
        done: [],
        next: "step 2 (Read the code and wire it)",
        closingLineOnly: false,
      });
      expect(readGuidedProgress([say(FRAMEWORK)])).toMatchObject({
        done: ["the framework line said"],
        next: "step 2 (Read the code and wire it)",
      });
      expect(readGuidedProgress(step2)).toMatchObject({
        done: ["the three step 2 lines said"],
        next: "step 3 (Propose the first scenario, and stop)",
      });
      expect(readGuidedProgress([...step2, answered()])).toMatchObject({
        done: ["the three step 2 lines said", "the first scenario card answered"],
        next: "step 4 (The checklist, then create, explain, run)",
      });
      const ran = [
        ...step2,
        answered(),
        shell("langwatch scenario run scenario_1 --wait --format json"),
      ];
      expect(readGuidedProgress(ran)).toMatchObject({
        done: [
          "the three step 2 lines said",
          "the first scenario card answered",
          "the first scenario run",
        ],
        next: "step 5 (From one run to a suite)",
      });
      const suite = [...ran, shell("langwatch test-suite run suite_1 --wait --format json")];
      expect(readGuidedProgress(suite)).toMatchObject({
        done: [
          "the three step 2 lines said",
          "the first scenario card answered",
          "the first scenario run",
          "the suite run",
        ],
        next: "item 8 of step 5 (From one run to a suite), Open the suite run",
      });
      expect(
        readGuidedProgress([...suite, shell(`${COMPLETE_PATH_COMMAND} llmops`)]),
      ).toMatchObject({
        done: expect.arrayContaining(["complete-path run"]),
        next: "the closing line of step 5 (From one run to a suite)",
        closingLineOnly: true,
      });
      expect(progressMessage(readGuidedProgress([...step2, answered()]))).toBe(
        "The path is not finished. The history shows: the three step 2 lines said and the first scenario card answered. Continue from step 4 (The checklist, then create, explain, run), through `langwatch onboarding complete-path` and the closing line.",
      );
      expect(progressMessage(readGuidedProgress([]))).toBe(
        "The path is not finished. The history shows none of the path's steps done. Continue from step 2 (Read the code and wire it), through `langwatch onboarding complete-path` and the closing line.",
      );
      expect(
        progressMessage(readGuidedProgress([...suite, shell(`${COMPLETE_PATH_COMMAND} llmops`)])),
      ).toBe(
        "The path is not finished. The history shows: the three step 2 lines said, the first scenario card answered, the first scenario run, the suite run and complete-path run. Say the closing line of step 5 (From one run to a suite), and stop.",
      );
    });

    it("continues from step 4 when the history carries the answered card, live or folded into a seed", () => {
      const live = [
        KICKOFF,
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "c1", name: "say", arguments: { text: FRAMEWORK } },
            { type: "toolCall", id: "c2", name: "say", arguments: { text: BRANCH } },
            { type: "toolCall", id: "c3", name: "say", arguments: { text: PULL_REQUEST } },
            {
              type: "toolCall",
              id: "c4",
              name: "question",
              arguments: { questions: [{ header: "Propose the first scenario" }] },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "say",
          content: [{ type: "text", text: "Said." }],
        },
        {
          role: "toolResult",
          toolCallId: "c2",
          toolName: "say",
          content: [{ type: "text", text: "Said." }],
        },
        {
          role: "toolResult",
          toolCallId: "c3",
          toolName: "say",
          content: [{ type: "text", text: "Said." }],
        },
        {
          role: "toolResult",
          toolCallId: "c4",
          toolName: "question",
          content: [{ type: "text", text: `A: Create it\n\n${ANSWERED_CONTINUE_LINE}` }],
        },
      ];
      const seed = [
        "[Resumed conversation: digest of the previous worker's session. Newest messages last; the oldest may be truncated.]",
        `user: ${KICKOFF.content}`,
        `assistant: [tool call: say ${JSON.stringify({ text: FRAMEWORK })}]`,
        "toolResult(say): Said.",
        `assistant: [tool call: say ${JSON.stringify({ text: BRANCH })}]`,
        "toolResult(say): Said.",
        `assistant: [tool call: say ${JSON.stringify({ text: PULL_REQUEST })}]`,
        "toolResult(say): Said.",
        'assistant: [tool call: question {"questions":[{"header":"Propose the first scenario"}]}]',
        `toolResult(question): A: Create it\n\n${ANSWERED_CONTINUE_LINE}`,
        "[End of digest. The user's current message follows.]",
        "",
        "Go ahead, keep going.",
      ].join("\n");
      const turn = [say("Continuing the setup.")];
      const expected = {
        kind: "continue",
        segment: 1,
        missing: ["the next step"],
        message:
          "The path is not finished. The history shows: the three step 2 lines said and the first scenario card answered. Continue from step 4 (The checklist, then create, explain, run), through `langwatch onboarding complete-path` and the closing line.",
      };
      expect(
        decideGuidedContinuation({ calls: turn, guided: true, continuations: 0, history: live }),
      ).toEqual(expected);
      expect(
        decideGuidedContinuation({
          calls: turn,
          guided: true,
          continuations: 0,
          history: [{ role: "user", content: [{ type: "text", text: seed }] }],
        }),
      ).toEqual(expected);
    });

    it("continues from step 2 when the history shows nothing done, and reads the turn's own calls with it", () => {
      expect(
        decideGuidedContinuation({
          calls: [say("Continuing the setup.")],
          guided: true,
          continuations: 0,
          history: [KICKOFF],
        }),
      ).toMatchObject({
        kind: "continue",
        message:
          "The path is not finished. The history shows none of the path's steps done. Continue from step 2 (Read the code and wire it), through `langwatch onboarding complete-path` and the closing line.",
      });
      expect(
        decideGuidedContinuation({
          calls: [
            shell("langwatch scenario run scenario_1 --wait --format json"),
            say("Two things."),
          ],
          guided: true,
          continuations: 0,
          history: [KICKOFF],
        }),
      ).toMatchObject({
        message:
          "The path is not finished. The history shows: the first scenario run. Continue from step 5 (From one run to a suite), through `langwatch onboarding complete-path` and the closing line.",
      });
    });

    it("keeps the plain continuation on a path without numbered steps, and the step 2 and answered-card ones as they are", () => {
      const gateway = {
        role: "user",
        content: "Guided onboarding kickoff.\nPath to set up now: gateway (Gateway).",
      };
      expect(guidedPathInHistory([KICKOFF])).toBe("llmops");
      expect(
        guidedPathInHistory([
          KICKOFF,
          { role: "user", content: `Let's set up Gateway then.\n${gateway.content}` },
        ]),
      ).toBe("gateway");
      expect(
        guidedPathInHistory([{ role: "user", content: "How do I add a trace?" }]),
      ).toBeUndefined();
      expect(
        decideGuidedContinuation({
          calls: [say("Here is the key.")],
          guided: true,
          continuations: 0,
          history: [gateway],
        }),
      ).toMatchObject({
        message:
          "The path is not finished. Continue with the next step of the guided onboarding skill; end on the question card or the closing line.",
      });
      expect(
        decideGuidedContinuation({
          calls: [plan("completed"), say(FRAMEWORK), say(PULL_REQUEST)],
          guided: true,
          continuations: 0,
          history: [KICKOFF],
        }),
      ).toMatchObject({ missing: ["the branch line", "the first scenario card"] });
      expect(
        decideGuidedContinuation({
          calls: [...step2, answered()],
          guided: true,
          continuations: 0,
          history: [KICKOFF],
        }),
      ).toMatchObject({ segment: 2, message: ANSWERED_CARD_MESSAGE });
    });
  });

  describe("when a card was answered inside the turn", () => {
    const step2 = [plan("completed"), say(FRAMEWORK), say(BRANCH), say(NO_REMOTE)];

    /** @scenario "An answered card is not an ending" */
    it("reads the calls after the answer as a segment of their own, and continues a bare end there", () => {
      // The r42 shape: the card answered, then nothing.
      const stopped = [...step2, answered()];
      expect(guidedSegment(stopped)).toEqual({ index: 2, calls: [] });
      expect(decideGuidedContinuation({ calls: stopped, guided: true, continuations: 0 })).toEqual({
        kind: "continue",
        segment: 2,
        missing: ["the work that follows the answer"],
        message: ANSWERED_CARD_MESSAGE,
      });
      expect(ANSWERED_CARD_MESSAGE).toBe(
        "The card was answered. Continue with the work that follows the answer: step 4 and step 5 of the guided onboarding skill, through `langwatch onboarding complete-path` and the closing line.",
      );
      // Lines only after the answer are bare too, and step 2 reading does not follow the answer.
      const linesOnly = [...stopped, say("Running it against your agent now."), plan("completed")];
      expect(
        decideGuidedContinuation({ calls: linesOnly, guided: true, continuations: 0 }),
      ).toMatchObject({
        kind: "continue",
        segment: 2,
        message: ANSWERED_CARD_MESSAGE,
      });
      // A card still waiting is an ending, before and after an answer.
      expect(
        decideGuidedContinuation({ calls: [...step2, question()], guided: true, continuations: 0 }),
      ).toEqual({
        kind: "leave",
        reason: "card",
      });
      expect(
        decideGuidedContinuation({
          calls: [...stopped, question()],
          guided: true,
          continuations: 0,
        }),
      ).toEqual({
        kind: "leave",
        reason: "card",
      });
      // The work after the answer, done to the closing line, is left alone.
      const finished = [...stopped, shell(`${COMPLETE_PATH_COMMAND} llmops`), say(CLOSING_LINE)];
      expect(decideGuidedContinuation({ calls: finished, guided: true, continuations: 0 })).toEqual(
        {
          kind: "leave",
          reason: "closing_line",
        },
      );
    });

    /** @scenario "An answered card is not an ending" */
    it("gives each segment one continuation, three per turn at most", () => {
      const stopped = [...step2, answered()];
      // The segment's own continuation was spent: reported and left.
      expect(decideGuidedContinuation({ calls: stopped, guided: true, continuations: 1 })).toEqual({
        kind: "give_up",
        segment: 2,
        missing: ["the work that follows the answer"],
      });
      // A fresh segment with the turn's cap reached is left too.
      expect(MAX_TURN_CONTINUATIONS).toBe(3);
      expect(
        decideGuidedContinuation({
          calls: stopped,
          guided: true,
          continuations: 0,
          turnContinuations: 3,
        }),
      ).toEqual({ kind: "give_up", segment: 2, missing: ["the work that follows the answer"] });
      expect(
        decideGuidedContinuation({
          calls: stopped,
          guided: true,
          continuations: 0,
          turnContinuations: 2,
        }),
      ).toMatchObject({ kind: "continue", segment: 2 });
      // Two answered cards: the third segment.
      const twice = [...stopped, say("Running it against your agent now."), answered()];
      expect(guidedSegment(twice).index).toBe(3);
    });
  });

  describe("when a step 2 turn ends with lines unsaid", () => {
    /** @scenario "The continuation names the step 2 lines the turn did not say" */
    it("names the missing line and the card, and only the card when every line was said", () => {
      // The r40 turn: the framework line, the pull request line, the plan all
      // done, and the branch line never said.
      const r40 = [
        say(FRAMEWORK),
        plan("in_progress"),
        say(PULL_REQUEST),
        plan("completed"),
        plan("completed"),
      ];
      expect(missingStep2Lines(r40)).toEqual(["the branch line"]);
      expect(decideGuidedContinuation({ calls: r40, guided: true, continuations: 0 })).toEqual({
        kind: "continue",
        segment: 1,
        missing: ["the branch line", "the first scenario card"],
        message:
          "Step 2 is not finished: the branch line was not said, and the first scenario card was not asked. Say the missing line, then continue with step 3 and end on the question card.",
      });

      const twoMissing = [plan("completed"), say(PULL_REQUEST)];
      expect(
        decideGuidedContinuation({ calls: twoMissing, guided: true, continuations: 0 }),
      ).toMatchObject({
        kind: "continue",
        message:
          "Step 2 is not finished: the framework line and the branch line were not said, and the first scenario card was not asked. Say the missing lines, then continue with step 3 and end on the question card.",
      });

      const allLines = [plan("completed"), say(FRAMEWORK), say(BRANCH), say(NO_REMOTE)];
      expect(missingStep2Lines(allLines)).toEqual([]);
      expect(
        decideGuidedContinuation({ calls: allLines, guided: true, continuations: 0 }),
      ).toMatchObject({
        kind: "continue",
        missing: ["the first scenario card"],
      });

      expect(
        decideGuidedContinuation({
          calls: [...allLines, question()],
          guided: true,
          continuations: 0,
        }),
      ).toEqual({ kind: "leave", reason: "card" });
    });

    it("reads a turn as step 2 from the wait command when the plan was never written", () => {
      const calls = [
        shell('langwatch agent list --wait-online "acme" --format json'),
        say(PULL_REQUEST),
      ];
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
    it("carries every template, the framework shape, the checklist item, the closing command and the closing line word for word", () => {
      for (const template of Object.values(STEP2_LINE_TEMPLATES)) {
        expect(skill).toContain(template);
      }
      expect(skill).toContain(FRAMEWORK_LINE_SHAPE);
      expect(skill).toContain(`11. ${STEP2_LINES_ITEM}`);
      expect(skill).toContain(`${COMPLETE_PATH_COMMAND} <path>`);
      expect(skill).toContain(`\n${CLOSING_LINE}\n`);
    });

    /** @scenario "The continuation names what the history shows done and the step to continue from" */
    it("numbers and titles the llmops steps the way the continuation names them", () => {
      for (const [number, title] of Object.entries(LLMOPS_STEP_TITLES)) {
        expect(skill).toContain(`\n### ${number}. ${title}\n`);
      }
      expect(skill).toContain("langwatch scenario run <scenario_id>");
      expect(skill).toContain("langwatch test-suite run <suite_id>");
    });

    it("matches a line with its braces filled and nothing else", () => {
      const branch = templatePattern(STEP2_LINE_TEMPLATES.branch);
      expect(branch.test(BRANCH)).toBe(true);
      expect(branch.test("I left the branch checked out.")).toBe(false);
      expect(branch.test(`${BRANCH} Next I will write a scenario.`)).toBe(false);
    });
  });

  describe("when the closing line is said", () => {
    /** @scenario "The closing line is refused before complete-path" */
    it("is refused until the complete-path command ran clean in the turn", () => {
      const early = [plan("completed"), say(FRAMEWORK), say(BRANCH), say(NO_REMOTE)];
      expect(completePathRan(early)).toBe(false);
      expect(closingLineRefusal({ text: CLOSING_LINE, calls: early })).toBe(CLOSING_LINE_PUSHBACK);
      expect(closingLineRefusal({ text: `${CLOSING_LINE} 🎉`, calls: early })).toBe(
        CLOSING_LINE_PUSHBACK,
      );
      expect(closingLineRefusal({ text: NO_REMOTE, calls: early })).toBeUndefined();

      const failed = [...early, shell(`${COMPLETE_PATH_COMMAND} llmops`, 1)];
      expect(completePathRan(failed)).toBe(false);
      expect(closingLineRefusal({ text: CLOSING_LINE, calls: failed })).toBe(CLOSING_LINE_PUSHBACK);

      const done = [...early, shell(`${COMPLETE_PATH_COMMAND} llmops`), plan("completed")];
      expect(completePathRan(done)).toBe(true);
      expect(closingLineRefusal({ text: CLOSING_LINE, calls: done })).toBeUndefined();
    });
  });

  describe("given pi's session events", () => {
    it("records each settled call with the input its start carried", () => {
      const log = new TurnCallLog();
      log.record({
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "Say",
        args: { text: FRAMEWORK },
      });
      log.record({ type: "tool_execution_update", toolCallId: "c1", toolName: "Say" });
      log.record({
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "Say",
        isError: false,
        result: { content: [{ type: "text", text: "Said." }] },
      });
      expect(log.calls).toEqual([
        { name: "say", input: { text: FRAMEWORK }, isError: false, output: "Said." },
      ]);
    });
  });
});
