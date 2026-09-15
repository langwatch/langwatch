import { firstPullRequestUrlIn } from "./langy.github-pr-url.ts";

export type GithubProgressStage =
  | "cloning"
  | "cloned"
  | "branched"
  | "committed"
  | "pushed"
  | "opening_pr"
  | "opened";

export type GithubProgressEvent = {
  stage: GithubProgressStage;
  detail?: string;
  /**
   * The pull request's own URL, on the `opened` stage. It is not in the command, it is in the
   * command's OUTPUT, which is why it is read separately from `detail`.
   */
  url?: string;
};

export type GithubStep = {
  begin?: GithubProgressStage;
  end: GithubProgressStage;
  detail?: string;
};

const networkGitSubcommands = new Set(["clone", "push", "fetch", "pull", "ls-remote"]);

export function needsGithubAuth(command: string): boolean {
  return commandSegments(command).some((segment) => isGhCli(segment) || isNetworkGit(segment));
}

/**
 * Every step of the PR flow this shell command performs, in the order it runs them. A chain is
 * normal, not an edge case: an agent working in a developer's own folder runs
 * `git add … && git commit … && git push … && gh pr create …` as one call.
 */
export function githubStepsOf(command: string): GithubStep[] {
  const steps: GithubStep[] = [];
  for (const tokens of commandSegments(command)) {
    const step = stepOfSegment(tokens);
    if (step) steps.push(step);
  }
  return steps;
}

/** The FIRST step of the PR flow this command performs, if any. */
export function githubStepOf(command: string): GithubStep | null {
  return githubStepsOf(command)[0] ?? null;
}

export function githubProgressFromToolParts(
  parts: readonly { type?: unknown; input?: unknown; state?: unknown; output?: unknown }[],
): GithubProgressEvent[] {
  return parts.flatMap((part) => progressForPart(part));
}

/** The events one tool part contributes. Empty for a call that ran no step. */
function progressForPart(part: {
  type?: unknown;
  input?: unknown;
  state?: unknown;
  output?: unknown;
}): GithubProgressEvent[] {
  if (typeof part.type !== "string" || !part.type.startsWith("tool-")) return [];
  const command = commandOf(part.input);
  if (!command) return [];
  // An errored command completed no step — a rejected push has not pushed.
  if (part.state === "output-error") return [];

  const steps = githubStepsOf(command);
  if (steps.length === 0) return [];

  if (part.state === "output-available") {
    // `gh pr create` prints the pull request's URL on stdout, so the opened step can link to
    // it. Only a settled, successful call has that output.
    const prUrl = firstPullRequestUrlIn(part.output);
    return steps.map((step) =>
      eventOf(step.end, step.detail, step.end === "opened" ? prUrl : undefined),
    );
  }

  // Still running: the card shows the FIRST step of the chain as under way. The rest have not
  // started, and a chain is run left to right.
  const first = steps[0]!;
  return first.begin ? [eventOf(first.begin, first.detail)] : [];
}

function eventOf(
  stage: GithubProgressStage,
  detail: string | undefined,
  url?: string,
): GithubProgressEvent {
  return { stage, ...(detail ? { detail } : {}), ...(url ? { url } : {}) };
}

function stepOfSegment(tokens: string[]): GithubStep | null {
  const [argv0, ...rest] = tokens;

  if (argv0 === "gh") {
    if (rest[0] === "repo" && rest[1] === "clone") {
      return { begin: "cloning", end: "cloned", detail: repoSlug(rest[2]) };
    }

    if (rest[0] === "pr" && rest[1] === "create") {
      return { begin: "opening_pr", end: "opened" };
    }

    return null;
  }

  if (argv0 !== "git") return null;

  const git = gitSubcommand(rest);
  if (!git) return null;

  const [subcommand, ...args] = git;

  switch (subcommand) {
    case "clone":
      return {
        begin: "cloning",
        end: "cloned",
        detail: repoSlug(args.find((arg) => !arg.startsWith("-"))),
      };
    case "checkout": {
      const branchOptionIndex = args.findIndex((arg) => arg === "-b" || arg === "-B");
      return branchOptionIndex === -1
        ? null
        : { end: "branched", detail: args[branchOptionIndex + 1] };
    }
    case "commit":
      return { end: "committed", detail: valueAfter(args, "-m") };
    case "push":
      return { end: "pushed" };
    default:
      return null;
  }
}

function gitSubcommand(rest: string[]): string[] | null {
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) continue;

    if (token.startsWith("-")) {
      if (token === "-C" || token === "-c") index += 1;
      continue;
    }

    return rest.slice(index);
  }

  return null;
}

function repoSlug(arg: string | undefined): string | undefined {
  if (!arg) return undefined;

  const cleaned = arg.replace(/\.git$/, "");
  return /([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)$/.exec(cleaned)?.[1];
}

function valueAfter(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex === -1) return undefined;

  const words: string[] = [];
  for (
    let index = flagIndex + 1;
    index < args.length && !args[index]?.startsWith("-");
    index += 1
  ) {
    const word = args[index];
    if (word) words.push(word);
  }

  return words.join(" ").trim() || undefined;
}

function isGhCli(tokens: string[]): boolean {
  return tokens[0] === "gh";
}

function isNetworkGit(tokens: string[]): boolean {
  if (tokens[0] !== "git") return false;

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;

    if (token.startsWith("-")) {
      if (token === "-C" || token === "-c") index += 1;
      continue;
    }

    return networkGitSubcommands.has(token);
  }

  return false;
}

function commandOf(input: unknown): string | null {
  const parsed = z.object({ command: z.string() }).safeParse(input);
  return parsed.success ? parsed.data.command : null;
}

function commandSegments(command: string): string[][] {
  return command
    .split(/\|\||&&|[;\n|]|\$\(|`|\)/)
    .map((segment) => tokenize(segment))
    .filter((tokens) => tokens.length > 0);
}

function tokenize(segment: string): string[] {
  const tokens = segment
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  let start = 0;
  while (start < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start]!)) {
    start += 1;
  }

  return tokens.slice(start);
}
import { z } from "zod";
