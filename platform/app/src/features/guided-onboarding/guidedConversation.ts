/**
 * What a guided onboarding conversation's transcript says about the path.
 *
 * A guided conversation starts with the kickoff part (a user message on the
 * wire, the tour card on screen) and ends when the skill runs
 * `langwatch onboarding complete-path`. Between the two the panel tells the
 * pull request differently from an ordinary conversation: the skill says it
 * as a sentence with the link before the proposal, and one card closes the
 * path after the closing line. The step-by-step progress receipt and the
 * feedback ask stay out of the way meanwhile.
 *
 * Everything here reads the parts the transcript already carries, never the
 * prose: the branch from the checkout command, the title and the address from
 * the `gh pr create` call and its own stdout.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { githubStepsOf } from "~/server/app-layer/langy/execution/githubCommand";
import { parseLangwatchCommand } from "~/server/app-layer/langy/execution/langwatchCommand";
import { firstPullRequestUrlIn } from "~/shared/langy/githubPrUrl";
import { guidedKickoffPartOf } from "./kickoff";

interface MessageLike {
  role: string;
  parts?: readonly unknown[];
}

interface ToolPartLike {
  type?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

/** The typed name the server envelope gives the done marker. */
const COMPLETE_PATH_TOOL_TYPE = "tool-langwatch.onboarding.complete-path";

function toolPart(part: unknown): ToolPartLike | null {
  if (!part || typeof part !== "object") return null;
  const p = part as ToolPartLike;
  return typeof p.type === "string" && p.type.startsWith("tool-") ? p : null;
}

function commandOf(part: ToolPartLike): string | undefined {
  const command = (part.input as { command?: unknown } | undefined)?.command;
  return typeof command === "string" ? command : undefined;
}

function settled(part: ToolPartLike): boolean {
  return part.state === "output-available";
}

/** Does this conversation run a guided path: a kickoff part in a user message? */
export function isGuidedConversation(
  messages: readonly MessageLike[],
): boolean {
  return messages.some(
    (message) =>
      message.role === "user" && guidedKickoffPartOf(message.parts) !== null,
  );
}

/** Did this message's calls close the path: a settled `onboarding complete-path`? */
export function guidedPathCompletedIn(parts: readonly unknown[]): boolean {
  return parts.some((raw) => {
    const part = toolPart(raw);
    if (!part || !settled(part)) return false;
    if (part.type === COMPLETE_PATH_TOOL_TYPE) return true;
    const command = commandOf(part);
    if (!command) return false;
    const parsed = parseLangwatchCommand(command);
    return parsed?.resource === "onboarding" && parsed.verb === "complete-path";
  });
}

/**
 * Is a guided path still under way: a kickoff exists and no reply since it
 * closed the path. The feedback ask waits for this to be false.
 */
export function guidedPathInProgress(
  messages: readonly MessageLike[],
): boolean {
  const kickoffAt = messages.findLastIndex(
    (message) =>
      message.role === "user" && guidedKickoffPartOf(message.parts) !== null,
  );
  if (kickoffAt === -1) return false;
  return !messages
    .slice(kickoffAt + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        guidedPathCompletedIn(message.parts ?? []),
    );
}

/** The pull request the path opened, or the branch alone when it could not. */
export interface GuidedPullRequest {
  url?: string;
  title?: string;
  branch?: string;
}

const PR_TITLE_FLAG = /--title(?:=|\s+)(?:"([^"]*)"|'([^']*)'|(\S+))/;
const WORKTREE_BRANCH = /\bworktree\s+add\b[^\n;&|]*?\s-b\s+(\S+)/;

function pullRequestTitleOf(command: string): string | undefined {
  const match = PR_TITLE_FLAG.exec(command);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function branchOf(command: string): string | undefined {
  const step = githubStepsOf(command).find((s) => s.end === "branched");
  if (step?.detail) return step.detail;
  return WORKTREE_BRANCH.exec(command)?.[1];
}

/** Every settled shell call in the assistant messages, with what it printed. */
function settledCommands(
  messages: readonly MessageLike[],
): { command: string; output: unknown }[] {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts ?? [])
    .map(toolPart)
    .flatMap((part) => {
      if (!part || !settled(part)) return [];
      const command = commandOf(part);
      return command ? [{ command, output: part.output }] : [];
    });
}

/** The address and title of the pull request a `gh pr create` call opened. */
function pullRequestOpenedBy(
  command: string,
  output: unknown,
): Pick<GuidedPullRequest, "url" | "title"> | null {
  if (!/\bgh\s+pr\s+create\b/.test(command)) return null;
  const url = firstPullRequestUrlIn(output);
  if (!url) return null;
  const title = pullRequestTitleOf(command);
  return title ? { url, title } : { url };
}

/**
 * The pull request the conversation opened, read off its tool calls: the
 * branch from the checkout, the title from the `gh pr create` flags, the
 * address from that command's own stdout. Null when no branch was made.
 */
export function guidedPullRequestFromMessages(
  messages: readonly MessageLike[],
): GuidedPullRequest | null {
  const found: GuidedPullRequest = {};
  for (const { command, output } of settledCommands(messages)) {
    const branch = branchOf(command);
    if (branch) found.branch = branch;
    Object.assign(found, pullRequestOpenedBy(command, output));
  }
  return found.url || found.branch ? found : null;
}
