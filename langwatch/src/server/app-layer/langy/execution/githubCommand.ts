/**
 * The GitHub grammar: recognising, from a real shell tool call, that the agent
 * is reaching for GitHub.
 *
 * Sibling of `langwatchCommand.ts`, and it exists for the same reason. Langy
 * runs on opencode and does its GitHub work through the `gh` CLI and `git` in
 * the `bash` tool, so the intent arrives buried in a command string. We decode
 * it ONCE, here, from the tool stream the manager already forwards
 * (`langy.tool` frames carry `name` + `input`) — and never from the model's
 * prose.
 *
 * That distinction is the whole point. The previous design asked the model to
 * announce what it was about to do by printing `[langy:connect-github]` and
 * `[langy:progress:<stage>]` markers into its reply, and then regexed the reply
 * to drive the UI. That is an LLM being asked to be a reliable state machine in
 * text: it can paraphrase, forget, emit the marker in a turn that never needed
 * GitHub, or emit it twice. We do not need its cooperation. We can SEE it run
 * `gh repo clone`.
 *
 * @see langy-cli-envelope.service.ts — the same trick for the `langwatch` CLI.
 */

/**
 * Does this command need the user's GitHub credentials to work?
 *
 * `gh` is the GitHub CLI: every invocation authenticates with `GH_TOKEN`. `git
 * clone` / `push` / `fetch` / `pull` / `ls-remote` hit the network through the
 * `gh auth git-credential` helper the skill configures, so they need the token
 * too. Everything else `git` does is local (`checkout`, `commit`, `add`,
 * `config`) and works fine without it — a turn that only commits locally must
 * NOT be stopped for a missing GitHub connection.
 */
export function needsGithubAuth(command: string): boolean {
  return commandSegments(command).some(
    (segment) => isGhCli(segment) || isNetworkGit(segment),
  );
}

/**
 * The steps of opening a pull request, as the user sees them on the progress
 * card.
 *
 * There is deliberately no `edited` stage. The old prose protocol had one
 * because it had a slot for it, but the tool stream has no such boundary — a
 * turn edits across many `write`/`edit` calls with no single moment that is "the
 * edit". Rather than invent a boundary to preserve a stage that was an artifact
 * of the sentinel design, we drop it. Nothing is lost: the tool cards already
 * show WHICH files were written, and the progress card's visible track never
 * rendered `edited` anyway.
 */
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

/**
 * One step of the PR flow, recognised from the command that performs it.
 *
 * `begin` fires when the tool call STARTS (a clone takes seconds, so the card
 * should say it is under way) and `end` when it settles. Most steps are instant
 * enough to need only an `end`.
 */
export interface GithubStep {
  begin?: GithubProgressStage;
  end: GithubProgressStage;
  detail?: string;
}

/**
 * Which step of the PR flow, if any, this shell command performs.
 *
 * THE SOURCE OF TRUTH IS THE COMMAND, not a marker the model was asked to print
 * alongside it. `git push` IS the push — there is nothing to announce and
 * nothing to trust. Returns null for everything else, including local edits.
 */
export function githubStepOf(command: string): GithubStep | null {
  for (const tokens of commandSegments(command)) {
    const step = stepOfSegment(tokens);
    if (step) return step;
  }
  return null;
}

function stepOfSegment(tokens: string[]): GithubStep | null {
  const [argv0, ...rest] = tokens;

  if (argv0 === "gh") {
    // `gh repo clone owner/name -- --depth 1`
    if (rest[0] === "repo" && rest[1] === "clone") {
      return { begin: "cloning", end: "cloned", detail: repoSlug(rest[2]) };
    }
    // `gh pr create --title x --body y`. The detail — the PR's own URL — is NOT
    // in the command. It is in the command's OUTPUT, which the caller reads.
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
      // Only a NEW branch is the "branched" step; a plain checkout is not.
      const at = args.findIndex((arg) => arg === "-b" || arg === "-B");
      return at === -1 ? null : { end: "branched", detail: args[at + 1] };
    }
    case "commit":
      return { end: "committed", detail: valueAfter(args, "-m") };
    case "push":
      return { end: "pushed" };
    default:
      return null;
  }
}

/**
 * The PR-flow progress the browser draws, derived from an assistant message's
 * TOOL PARTS — the same parts the tool cards render from.
 *
 * This is what replaced reading `[langy:progress:...]` markers out of the reply,
 * and it is strictly better in a way that matters: the sentinels were STRIPPED
 * before the message was persisted, so the progress card never survived a
 * refresh. Tool parts are persisted with the message, so it does now.
 *
 * A tool part carries the command in `input.command` and settles into an
 * `output-available` / `output-error` state. An errored command completed no
 * step — a rejected push has not pushed.
 */
export function githubProgressFromToolParts(
  parts: readonly {
    type?: string;
    input?: unknown;
    state?: string;
  }[],
): GithubProgressEvent[] {
  const events: GithubProgressEvent[] = [];
  for (const part of parts) {
    if (typeof part.type !== "string" || !part.type.startsWith("tool-")) continue;
    const command = (part.input as { command?: unknown } | undefined)?.command;
    if (typeof command !== "string") continue;
    const step = githubStepOf(command);
    if (!step) continue;

    if (part.state === "output-error") continue;
    if (part.state === "output-available") {
      events.push(
        step.detail ? { stage: step.end, detail: step.detail } : { stage: step.end },
      );
    } else if (step.begin) {
      // Still running: the card shows the step as under way.
      events.push(
        step.detail
          ? { stage: step.begin, detail: step.detail }
          : { stage: step.begin },
      );
    }
  }
  return events;
}

/** Step past git's global flags (`-C <path>`, `-c <cfg>`) to the subcommand. */
function gitSubcommand(rest: string[]): string[] | null {
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith("-")) {
      if (token === "-C" || token === "-c") i++;
      continue;
    }
    return rest.slice(i);
  }
  return null;
}

/** `owner/name`, also from a clone URL's tail (`…/owner/name.git`). */
function repoSlug(arg: string | undefined): string | undefined {
  if (!arg) return undefined;
  const cleaned = arg.replace(/\.git$/, "");
  return /([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)$/.exec(cleaned)?.[1];
}

/**
 * The value after a flag. Tokenising split the quotes off `-m "fix the bug"`, so
 * rejoin the run of words up to the next flag.
 */
function valueAfter(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const words: string[] = [];
  for (let i = at + 1; i < args.length && !args[i]!.startsWith("-"); i++) {
    words.push(args[i]!);
  }
  return words.join(" ").trim() || undefined;
}

/** `gh <anything>` — the GitHub CLI always authenticates. */
function isGhCli(tokens: string[]): boolean {
  return tokens[0] === "gh";
}

/** The `git` subcommands that talk to the remote (and so need the token). */
const NETWORK_GIT_SUBCOMMANDS = new Set([
  "clone",
  "push",
  "fetch",
  "pull",
  "ls-remote",
]);

function isNetworkGit(tokens: string[]): boolean {
  if (tokens[0] !== "git") return false;
  // Skip `git -C /path push` style global flags to find the subcommand.
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.startsWith("-")) {
      // `-C <path>` and `-c <cfg>` take a value; skip it too.
      if (token === "-C" || token === "-c") i++;
      continue;
    }
    return NETWORK_GIT_SUBCOMMANDS.has(token);
  }
  return false;
}

/**
 * Split a shell command into the individual invocations it runs, tokenised.
 *
 * A single `bash` call is rarely a single command — the skill's own steps chain
 * them (`mkdir -p "$HOME/work" && cd "$HOME/work"`), and a `gh` call can hide
 * behind a `&&`, a `;`, a `|`, or a `$(…)`. Splitting on those separators means
 * `git add -A && git push` is seen for what it is: a push.
 *
 * Deliberately simple: this is a RECOGNISER, not a shell. It over-splits rather
 * than under-splits, because the cost of missing a `gh` is a turn that dies on a
 * confusing auth error instead of showing the connect card, while the cost of an
 * extra split is nothing.
 */
function commandSegments(command: string): string[][] {
  return command
    .split(/\|\||&&|[;\n|]|\$\(|`|\)/)
    .map((segment) => tokenize(segment))
    .filter((tokens) => tokens.length > 0);
}

/** Tokenise one invocation, dropping quotes and leading `env VAR=x` prefixes. */
function tokenize(segment: string): string[] {
  const tokens = segment
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  // `FOO=bar gh pr create` — step past inline env assignments to the real argv0.
  let start = 0;
  while (start < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start]!)) {
    start++;
  }
  return tokens.slice(start);
}
