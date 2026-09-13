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
 * goes on in the same turn. Once per turn; a second bare end is logged and
 * left.
 *
 * The step 2 lines and the checklist item are the skill's own words. This
 * package does not depend on the skills tree, so the copies here are pinned
 * to the skill source by a test rather than imported.
 */

import { contentText } from "./events.js";
import { GUIDED_KICKOFF_OPENER } from "./guided-kickoff.js";
import { CODE_ACCESS_TOOL_NAME } from "./tools/local-workspace.js";
import { QUESTION_TOOL_NAME } from "./tools/question.js";
import { SAY_TOOL_NAME } from "./tools/say.js";
import { normalizeTodos, TODOWRITE_TOOL_NAME } from "./tools/todowrite.js";

/** The log lines the runner writes, greppable by name. */
export const GUIDED_TURN_CONTINUED_LOG = "guided_turn_continued";
export const GUIDED_TURN_BARE_END_LOG = "guided_turn_bare_end";

/** The last item of the step 2 checklist: a turn that wrote it is a step 2 turn. */
export const STEP2_LINES_ITEM = "The three step 2 lines said";

/** The wait of step 2's item 6: a turn that ran it is a step 2 turn too. */
export const WAIT_ONLINE_MARKER = "agent list --wait-online";

/** The command that closes a path; the closing line follows it. */
export const COMPLETE_PATH_COMMAND = "langwatch onboarding complete-path";

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

/** The tools whose card holds the turn: a turn that ends on one ended as written. */
const CARD_TOOL_NAMES = new Set([QUESTION_TOOL_NAME, CODE_ACCESS_TOOL_NAME]);

/** The shell tools, in the worker's names and the CLI's. */
const SHELL_TOOL_NAMES = new Set(["bash", "shell", "execute", "local_bash"]);

export type TurnCall = {
  name: string;
  input: unknown;
  isError: boolean;
  output: string;
};

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

export type GuidedTurnEnder = "card" | "closing_line" | "failed_step" | "bare";

/**
 * What the turn ended on. Plan writes are bookkeeping and do not count as the
 * last call: a turn whose last calls are `todowrite` ended on whatever came
 * before them.
 */
export function guidedTurnEnding(calls: readonly TurnCall[]): GuidedTurnEnder {
  const meaningful = calls.filter((call) => call.name !== TODOWRITE_TOOL_NAME);
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

/** A conversation whose history carries the kickoff brief is on the guided path. */
export function historyHasGuidedKickoff(messages: readonly unknown[]): boolean {
  return messages.some((message) => {
    if (typeof message !== "object" || message === null) return false;
    const { role, content } = message as { role?: unknown; content?: unknown };
    if (role !== "user") return false;
    if (typeof content === "string") return content.includes(GUIDED_KICKOFF_OPENER);
    if (!Array.isArray(content)) return false;
    return content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        typeof (block as { text?: unknown }).text === "string" &&
        ((block as { text: string }).text).includes(GUIDED_KICKOFF_OPENER),
    );
  });
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
  | { kind: "continue"; missing: string[]; message: string }
  | { kind: "give_up"; missing: string[] };

/**
 * What to do with a guided turn that just ended. `continuations` counts the
 * messages already appended to this turn: one is the limit.
 */
export function decideGuidedContinuation({
  calls,
  guided,
  continuations,
}: {
  calls: readonly TurnCall[];
  guided: boolean;
  continuations: number;
}): GuidedContinuation {
  if (!guided) return { kind: "leave", reason: "not_guided" };
  const ender = guidedTurnEnding(calls);
  if (ender !== "bare") return { kind: "leave", reason: ender };
  const step2 = isStep2Turn(calls);
  const missingLines = step2 ? missingStep2Lines(calls) : [];
  const missing = step2 ? [...missingLines, "the first scenario card"] : ["the next step"];
  if (continuations >= 1) return { kind: "give_up", missing };
  return {
    kind: "continue",
    missing,
    message: continuationMessage({ step2, missing: missingLines }),
  };
}
