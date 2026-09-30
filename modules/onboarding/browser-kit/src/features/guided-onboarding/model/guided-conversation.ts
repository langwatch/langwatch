/**
 * What a guided onboarding conversation's transcript says about the path.
 *
 * A guided conversation starts with the kickoff part (a user message on the wire, the tour
 * card on screen) and ends when the skill runs `langwatch onboarding complete-path`. Everything
 * here reads the parts the transcript already carries, never the prose: the branch from the
 * checkout command, the title and address from the `gh pr create` call and its own stdout.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { githubStepsOf, parseLangwatchCommand, pullRequestUrlsIn } from "@langwatch/langy-contract";
import { z } from "zod";

import { guidedKickoffPartOf } from "./kickoff.ts";

const messageSchema = z.object({
  role: z.string(),
  parts: z.array(z.unknown()).optional(),
});
type MessageLike = z.infer<typeof messageSchema>;

const toolPartSchema = z.object({
  type: z.string().startsWith("tool-"),
  state: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
});
type ToolPart = z.infer<typeof toolPartSchema>;

const commandInputSchema = z.object({ command: z.string() });

/** The typed name the server envelope gives the done marker. */
const COMPLETE_PATH_TOOL_TYPE = "tool-langwatch.onboarding.complete-path";

/** The settled tool call a part is, or null. */
function settledToolPart(part: unknown): ToolPart | null {
  const parsed = toolPartSchema.safeParse(part);
  return parsed.success && parsed.data.state === "output-available" ? parsed.data : null;
}

function commandOf(part: ToolPart): string | undefined {
  const parsed = commandInputSchema.safeParse(part.input);
  return parsed.success ? parsed.data.command : undefined;
}

function kickoffMessage(message: MessageLike): boolean {
  return message.role === "user" && guidedKickoffPartOf(message.parts) !== null;
}

/** Does this conversation run a guided path: a kickoff part in a user message? */
export function isGuidedConversation(messages: readonly MessageLike[]): boolean {
  return messages.some(kickoffMessage);
}

/** Did this message's calls close the path: a settled `onboarding complete-path`? */
export function guidedPathCompletedIn(parts: readonly unknown[]): boolean {
  return parts.some((raw) => {
    const part = settledToolPart(raw);
    if (!part) return false;
    if (part.type === COMPLETE_PATH_TOOL_TYPE) return true;
    const command = commandOf(part);
    const parsed = command ? parseLangwatchCommand(command) : null;
    return parsed?.resource === "onboarding" && parsed.verb === "complete-path";
  });
}

/**
 * Is a guided path still under way: a kickoff exists and no reply since it closed the path.
 * The feedback ask waits for this to be false.
 */
export function guidedPathInProgress(messages: readonly MessageLike[]): boolean {
  const kickoffAt = messages.findLastIndex(kickoffMessage);
  if (kickoffAt === -1) return false;
  return !messages
    .slice(kickoffAt + 1)
    .some((message) => message.role === "assistant" && guidedPathCompletedIn(message.parts ?? []));
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
  return step?.detail ?? WORKTREE_BRANCH.exec(command)?.[1];
}

/** Every settled shell call in the assistant messages, with what it printed. */
function settledCommands(messages: readonly MessageLike[]): { command: string; output: unknown }[] {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts ?? [])
    .flatMap((raw) => {
      const part = settledToolPart(raw);
      const command = part ? commandOf(part) : undefined;
      return part && command ? [{ command, output: part.output }] : [];
    });
}

/** The address and title of the pull request a `gh pr create` call opened. */
function pullRequestOpenedBy(
  command: string,
  output: unknown,
): Pick<GuidedPullRequest, "url" | "title"> | null {
  if (!/\bgh\s+pr\s+create\b/.test(command)) return null;
  const url = pullRequestUrlsIn(output)[0]?.url;
  if (!url) return null;
  const title = pullRequestTitleOf(command);
  return title ? { url, title } : { url };
}

/**
 * The pull request the conversation opened, read off its tool calls: the branch from the
 * checkout, the title from the `gh pr create` flags, the address from that command's own
 * stdout. Null when no branch was made.
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
