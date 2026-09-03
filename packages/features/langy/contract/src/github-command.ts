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

export function githubStepOf(command: string): GithubStep | null {
  for (const tokens of commandSegments(command)) {
    const step = stepOfSegment(tokens);
    if (step) return step;
  }

  return null;
}

export function githubProgressFromToolParts(
  parts: readonly { type?: unknown; input?: unknown; state?: unknown }[],
): GithubProgressEvent[] {
  const events: GithubProgressEvent[] = [];

  for (const part of parts) {
    if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
      continue;
    }

    const command = commandOf(part.input);
    if (!command) continue;

    const step = githubStepOf(command);
    if (!step || part.state === "output-error") continue;

    if (part.state === "output-available") {
      events.push(eventOf(step.end, step.detail));
      continue;
    }

    if (step.begin) events.push(eventOf(step.begin, step.detail));
  }

  return events;
}

function eventOf(stage: GithubProgressStage, detail: string | undefined): GithubProgressEvent {
  return detail ? { stage, detail } : { stage };
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
