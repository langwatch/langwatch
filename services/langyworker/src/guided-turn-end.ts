/**
 * The guard on how a guided onboarding turn ends.
 *
 * The guided skill names the calls a turn may end on: the question card of
 * step 3, the closing line after `langwatch onboarding complete-path`, or the
 * one line of a failed step. Films kept ending the step 2 turn on the plan
 * write instead, the card never asked, and one of them ticked "the three step
 * 2 lines said" with one of the lines never said. The prose does not hold on
 * its own, so the runner reads the turn's own calls: a guided turn that ends
 * bare gets one continuation message naming what it still owes, and the model
 * goes on in the same turn. Once per segment; a second bare end is reported
 * and left. Both reports ride the protocol as `guided_turn` events: the
 * manager does not read worker stderr, so it logs them under their names.
 *
 * A card is an ending only while it waits. The product answers a card inside
 * the turn when the person picks before the turn ends, and the tool result
 * then carries the answer and the go, so the turn owes the work that
 * follows. The calls after an answered card are read as a segment of their
 * own, with one continuation of their own, and a small cap over the turn.
 *
 * The closing line has a rule of its own, read by the `say` tool as the line
 * is said rather than at the turn's end: it comes after the complete-path
 * command, and a say that carries it earlier is refused and draws nothing,
 * since a line already drawn is not taken back by a continuation.
 *
 * The step 2 lines, the closing line and the checklist item are the skill's
 * own words. This package does not depend on the skills tree, so the copies
 * here are pinned to the skill source by a test rather than imported.
 */

import { contentText } from "./events.js";
import {
  CODE_ACCESS_TOOL_NAME,
  LOCAL_TOOL_NAMES,
  SANDBOX_FILE_TOOL_NAMES,
} from "./tools/local-workspace.js";
import { ANSWERED_CONTINUE_LINE, QUESTION_TOOL_NAME } from "./tools/question.js";
import { SAY_TOOL_NAME } from "./tools/say.js";
import { SKILL_TOOL_NAME } from "./tools/skill.js";
import { normalizeTodos, TODOWRITE_TOOL_NAME } from "./tools/todowrite.js";
import type { SettledCall } from "./tools/turn-context.js";

/** The names of the guard's two reports, sent to the manager and logged there under these names. */
export const GUIDED_TURN_CONTINUED_LOG = "guided_turn_continued";
export const GUIDED_TURN_BARE_END_LOG = "guided_turn_bare_end";

/** The last item of the step 2 checklist: a turn that wrote it is a step 2 turn. */
export const STEP2_LINES_ITEM = "The three step 2 lines said";

/** The wait of step 2's item 6: a turn that ran it is a step 2 turn too. */
export const WAIT_ONLINE_MARKER = "agent list --wait-online";

/** The command that closes a path; the closing line follows it. */
export const COMPLETE_PATH_COMMAND = "langwatch onboarding complete-path";

/** The closing line of every path, said once the complete-path command has run. */
export const CLOSING_LINE = "All ready! Let me know if there is anything I can help with.";

/** What `say` answers to the closing line while the complete-path command has not run. */
export const CLOSING_LINE_PUSHBACK =
  "Nothing was said: the closing line comes after `langwatch onboarding complete-path`; the path is not done. Go on with the step, and say the closing line once that command has run clean.";

/** The shape the framework line takes: "I found a LangGraph agent in app/graph.py." */
export const FRAMEWORK_LINE_SHAPE = "I found a LangGraph agent in app/graph.py.";
const FRAMEWORK_LINE_PATTERN = /^I found an? .+ agent in .+\.$/;

/** The templates of the other step 2 lines, brace for brace as the skill writes them. */
export const STEP2_LINE_TEMPLATES = {
  branch: "I left branch {branch} checked out: the agent you started runs on it.",
  pullRequest:
    "I opened a pull request with the tracing change: {link}. You can merge it already.",
  noRemote:
    "No pull request was opened, since the folder has no remote or gh is not signed in: branch {branch} holds the commit.",
  failedOpen: "The branch {branch} is pushed; opening the pull request failed with: {error}.",
} as const;

/** The tools whose card holds the turn: a turn that ends on one, still waiting, ended as written. */
const CARD_TOOL_NAMES = new Set([QUESTION_TOOL_NAME, CODE_ACCESS_TOOL_NAME]);

/** The message after a card answered inside the turn whose work never followed. */
export const ANSWERED_CARD_MESSAGE =
  "The card was answered. Continue with the work that follows the answer: step 4 and step 5 of the guided onboarding skill, through `langwatch onboarding complete-path` and the closing line.";

/** Continuations over one turn, all its segments counted; one per segment within it. */
export const MAX_TURN_CONTINUATIONS = 3;

/** The shell tools, in the worker's names and the CLI's. */
const SHELL_TOOL_NAMES = new Set(["bash", "shell", "execute", "local_bash"]);

/** The tools that write a file: a turn that ends on one ended on it. */
const WRITING_TOOL_NAMES = new Set(["write", "edit", "local_write", "local_edit"]);

/**
 * The calls the ender reads through. A plan write, a skill load and the
 * read-only lookups of both tool sets say nothing to the user, so a turn
 * whose last calls are these ended on whatever came before them. A `say`, a
 * card, a file write and a shell call are what a turn ends on, with one
 * exception: `langwatch navigate` below.
 */
export const TRANSPARENT_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  TODOWRITE_TOOL_NAME,
  SKILL_TOOL_NAME,
  ...SANDBOX_FILE_TOOL_NAMES.filter((name) => !WRITING_TOOL_NAMES.has(name)),
  ...LOCAL_TOOL_NAMES.filter((name) => !WRITING_TOOL_NAMES.has(name) && !SHELL_TOOL_NAMES.has(name)),
]);

/** `langwatch navigate ...` opens a page beside the panel and says nothing: a shell call the ender reads through. */
const NAVIGATE_COMMAND = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*langwatch\s+navigate\b/;

export type TurnCall = SettledCall;

/** The calls of one turn, in order, read off pi's session events. */
export class TurnCallLog {
  private readonly inputs = new Map<string, unknown>();
  readonly calls: TurnCall[] = [];

  record(event: { type: string; [key: string]: unknown }): void {
    if (event.type === "tool_execution_start") {
      this.inputs.set(String(event.toolCallId ?? ""), event.args);
      return;
    }
    if (event.type !== "tool_execution_end") return;
    const id = String(event.toolCallId ?? "");
    const input = this.inputs.get(id);
    this.inputs.delete(id);
    this.calls.push({
      name: String(event.toolName ?? "").toLowerCase(),
      input,
      isError: event.isError === true,
      output: contentText(event.result),
    });
  }
}

/** A template with braces, as a pattern over the whole line. */
export function templatePattern(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\\\{[a-z]+\\\}/g, "[\\s\\S]+?")}$`);
}

const BRANCH_LINE = templatePattern(STEP2_LINE_TEMPLATES.branch);
const PULL_REQUEST_LINES = [
  templatePattern(STEP2_LINE_TEMPLATES.pullRequest),
  templatePattern(STEP2_LINE_TEMPLATES.noRemote),
  templatePattern(STEP2_LINE_TEMPLATES.failedOpen),
];

function inputField(input: unknown, field: string): unknown {
  if (typeof input !== "object" || input === null) return undefined;
  return (input as Record<string, unknown>)[field];
}

function sayTexts(calls: readonly TurnCall[]): string[] {
  return calls
    .filter((call) => call.name === SAY_TOOL_NAME)
    .map((call) => inputField(call.input, "text"))
    .filter((text): text is string => typeof text === "string")
    .map((text) => text.trim());
}

function shellCommand(call: TurnCall): string | undefined {
  if (!SHELL_TOOL_NAMES.has(call.name)) return undefined;
  const command = inputField(call.input, "command");
  return typeof command === "string" ? command : undefined;
}

function transparent(call: TurnCall): boolean {
  if (TRANSPARENT_TOOL_NAMES.has(call.name)) return true;
  const command = shellCommand(call);
  return command !== undefined && NAVIGATE_COMMAND.test(command.trim());
}

/** A shell result's exit code, as the CLI prints it on its first line. */
function exitCodeOf(output: string): number | undefined {
  const match = /^exit code:\s*(\d+)/m.exec(output);
  return match ? Number(match[1]) : undefined;
}

function failed(call: TurnCall): boolean {
  if (call.isError) return true;
  const code = exitCodeOf(call.output);
  return code !== undefined && code !== 0;
}

/** Did the turn run the complete-path command, and did it answer clean? */
export function completePathRan(calls: readonly TurnCall[]): boolean {
  return calls.some(
    (call) => shellCommand(call)?.includes(COMPLETE_PATH_COMMAND) === true && !failed(call),
  );
}

/**
 * The say tool's rule for the closing line: a say that carries it before the
 * complete-path command ran clean in the same turn is refused with the
 * pushback; any other line, and the closing line after the command, passes.
 */
export function closingLineRefusal({
  text,
  calls,
}: {
  text: string;
  calls: readonly TurnCall[];
}): string | undefined {
  if (!text.includes(CLOSING_LINE)) return undefined;
  return completePathRan(calls) ? undefined : CLOSING_LINE_PUSHBACK;
}

/**
 * A question card answered inside the turn: its result carries the answers
 * and the go. The code access card has no in-turn answer, the folder
 * connecting starts the next turn, so it is never one of these.
 */
function answeredInTurn(call: TurnCall): boolean {
  return call.name === QUESTION_TOOL_NAME && !call.isError && call.output.includes(ANSWERED_CONTINUE_LINE);
}

export type GuidedSegment = {
  /** 1 for the calls before any card answered in the turn, one more per answered card. */
  index: number;
  /** The calls since the last answered card, or the whole turn when none was. */
  calls: TurnCall[];
};

/** The turn's current segment: what the ender and the budget are read on. */
export function guidedSegment(calls: readonly TurnCall[]): GuidedSegment {
  let start = 0;
  let index = 1;
  calls.forEach((call, position) => {
    if (answeredInTurn(call)) {
      start = position + 1;
      index += 1;
    }
  });
  return { index, calls: calls.slice(start) };
}

export type GuidedTurnEnder = "card" | "closing_line" | "failed_step" | "bare";

/**
 * What the turn ended on, read off the last call that is not transparent: a
 * turn whose last calls are plan writes, lookups or navigates ended on
 * whatever came before them.
 */
export function guidedTurnEnding(calls: readonly TurnCall[]): GuidedTurnEnder {
  const meaningful = calls.filter((call) => !transparent(call));
  const last = meaningful[meaningful.length - 1];
  if (!last) return "bare";
  if (CARD_TOOL_NAMES.has(last.name)) return "card";
  if (last.name !== SAY_TOOL_NAME) return "bare";
  // The lines at the end are read against the last call that was not a line.
  let index = meaningful.length - 2;
  while (index >= 0 && meaningful[index]?.name === SAY_TOOL_NAME) index--;
  const anchor = meaningful[index];
  if (!anchor) return "bare";
  if (failed(anchor)) return "failed_step";
  if (shellCommand(anchor)?.includes(COMPLETE_PATH_COMMAND)) return "closing_line";
  return "bare";
}

/** A turn that wrote the step 2 checklist, or ran its wait, owes the step 2 lines. */
export function isStep2Turn(calls: readonly TurnCall[]): boolean {
  return calls.some((call) => {
    if (call.name === TODOWRITE_TOOL_NAME) {
      return normalizeTodos(call.input).some((item) => item.content === STEP2_LINES_ITEM);
    }
    return shellCommand(call)?.includes(WAIT_ONLINE_MARKER) === true;
  });
}

/** The step 2 lines the turn's `say` calls do not carry, by name. */
export function missingStep2Lines(calls: readonly TurnCall[]): string[] {
  const texts = sayTexts(calls);
  const missing: string[] = [];
  if (!texts.some((text) => FRAMEWORK_LINE_PATTERN.test(text))) missing.push("the framework line");
  if (!texts.some((text) => BRANCH_LINE.test(text))) missing.push("the branch line");
  if (!texts.some((text) => PULL_REQUEST_LINES.some((line) => line.test(text)))) {
    missing.push("the pull request line or the no-remote line");
  }
  return missing;
}

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The message the runner appends, naming exactly what the turn still owes. */
export function continuationMessage({
  step2,
  missing,
}: {
  step2: boolean;
  missing: readonly string[];
}): string {
  if (!step2) {
    return "The path is not finished. Continue with the next step of the guided onboarding skill; end on the question card or the closing line.";
  }
  if (missing.length === 0) {
    return "Step 2 is finished but step 3 never started: the first scenario card was not asked. Continue with step 3 and end on the question card.";
  }
  const verb = missing.length === 1 ? "was" : "were";
  const lines = missing.length === 1 ? "line" : "lines";
  return `Step 2 is not finished: ${listed(missing)} ${verb} not said, and the first scenario card was not asked. Say the missing ${lines}, then continue with step 3 and end on the question card.`;
}

export type GuidedContinuation =
  | { kind: "leave"; reason: "not_guided" | Exclude<GuidedTurnEnder, "bare"> }
  | { kind: "continue"; segment: number; missing: string[]; message: string }
  | { kind: "give_up"; segment: number; missing: string[] };

/**
 * What to do with a guided turn that just ended. The ender is read on the
 * turn's current segment, the calls since the last card answered inside the
 * turn. `continuations` counts the messages already appended to that
 * segment, one is the limit; `turnContinuations` counts them over the whole
 * turn, MAX_TURN_CONTINUATIONS is the cap.
 */
export function decideGuidedContinuation({
  calls,
  guided,
  continuations,
  turnContinuations = 0,
}: {
  calls: readonly TurnCall[];
  guided: boolean;
  continuations: number;
  turnContinuations?: number;
}): GuidedContinuation {
  if (!guided) return { kind: "leave", reason: "not_guided" };
  const segment = guidedSegment(calls);
  const ender = guidedTurnEnding(segment.calls);
  if (ender !== "bare") return { kind: "leave", reason: ender };
  const afterAnswer = segment.index > 1;
  const step2 = !afterAnswer && isStep2Turn(segment.calls);
  const missingLines = step2 ? missingStep2Lines(segment.calls) : [];
  const missing = afterAnswer
    ? ["the work that follows the answer"]
    : step2
      ? [...missingLines, "the first scenario card"]
      : ["the next step"];
  if (continuations >= 1 || turnContinuations >= MAX_TURN_CONTINUATIONS) {
    return { kind: "give_up", segment: segment.index, missing };
  }
  return {
    kind: "continue",
    segment: segment.index,
    missing,
    message: afterAnswer ? ANSWERED_CARD_MESSAGE : continuationMessage({ step2, missing: missingLines }),
  };
}
