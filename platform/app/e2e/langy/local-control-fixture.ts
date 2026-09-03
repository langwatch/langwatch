/**
 * The harness for the local control scenarios (ADR-129).
 *
 * It builds the world the feature needs and nothing more:
 *
 *  1. a demo application copied into a temporary git repository, with the
 *     LangWatch SDK dependency pointed at this checkout so the copy resolves
 *     outside the monorepo,
 *  2. the REAL command line, `langwatch langy --share-control`, in a tmux
 *     session, driven with `send-keys` the way a developer drives it,
 *  3. a watcher on the conversation that answers the permission cards and the
 *     question cards through tRPC, as the user, on a policy the test sets.
 *
 * Nothing here mocks the product. The scenario asks Langy in the panel's own
 * tRPC surface, Langy's tools reach the machine over the control socket, and
 * the facts the tests assert come from the repository, the terminal and the
 * conversation record.
 *
 * @see specs/langy/langy-dogfood-scenarios.feature
 * @see dev/docs/adr/129-langy-local-control.md
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_BASE, PROJECT_ID } from "./config";
import type { LangyAdapter } from "./langy-agent";
import { getSessionCookie, trpcMutate, trpcQuery } from "./trpc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The repository root of this checkout, from `platform/app/e2e/langy`. */
export const REPO_ROOT = path.resolve(__dirname, "../../../..");

/** Where a run puts the temporary repositories it shares with Langy. */
const SCENARIO_REPO_DIR = path.join(
  REPO_ROOT,
  ".claude",
  "tmp",
  "scenario-repos",
);

/** The demo applications a scenario can share. */
export type DemoLanguage = "python" | "typescript";

const DEMO_SOURCE: Record<DemoLanguage, string> = {
  python: path.join(REPO_ROOT, "dev", "dogfood", "acme-support", "python"),
  typescript: path.join(
    REPO_ROOT,
    "dev",
    "dogfood",
    "acme-support",
    "typescript",
  ),
};

/** Never copied: they are rebuilt in the temporary repository, or they are noise. */
const SKIPPED_ENTRIES = new Set([
  ".git",
  ".venv",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  "dist",
]);

const sh = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): string =>
  execFileSync(command, args, {
    encoding: "utf8",
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    timeout: options.timeoutMs ?? 600_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls until `read` answers something truthy, then returns it.
 *
 * Every wait in this file goes through here so a timeout says what it was
 * waiting for rather than dying on an assertion three steps later.
 */
async function waitFor<T>({
  what,
  read,
  timeoutMs,
  intervalMs = 1_000,
}: {
  what: string;
  read: () =>
    | Promise<T | null | undefined | false>
    | T
    | null
    | undefined
    | false;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      const value = await read();
      if (value) return value as T;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}${
          lastError ? ` (last error: ${String(lastError)})` : ""
        }`,
      );
    }
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// The credential the command line runs on
// ---------------------------------------------------------------------------

let cliApiKeyPromise: Promise<string> | null = null;

/**
 * A user-scoped API key for the test's own user, bound to the test project.
 *
 * The command line signs in with a device session, and a control request
 * belongs to a person: a plain project key has no user behind it and lists no
 * requests. Rather than clicking through the device-code screens, the fixture
 * mints the same class of credential the login mints, through the product's
 * own `apiKey.create` mutation, as the signed-in user. `LANGWATCH_API_KEY` in
 * the command line's environment is then the credential it resolves, which is
 * the documented environment path of `resolveCredentials`.
 *
 * The key carries one PROJECT-scoped binding, so the platform resolves the
 * project from the key alone and the command line never has to name one.
 *
 * The mint is read back before it is used. A `apiKey.create` that answers 200
 * has been seen to leave the binding unwritten under load, and the key that
 * comes back then reaches every route with "does not grant langy:view". That
 * failure surfaces two minutes later as a command line that never printed its
 * prompt, which says nothing about the cause, so it is caught here instead.
 */
export function getCliApiKey(): Promise<string> {
  cliApiKeyPromise ??= (async () => {
    try {
      const cookie = await getSessionCookie();
      const organizations = await trpcQuery<
        Array<{
          id: string;
          teams?: Array<{ projects?: Array<{ id: string }> }>;
        }>
      >({ cookie, path: "organization.getAll", input: {} });
      const organizationId =
        organizations.find((organization) =>
          (organization.teams ?? []).some((team) =>
            (team.projects ?? []).some((project) => project.id === PROJECT_ID),
          ),
        )?.id ?? organizations[0]?.id;
      if (!organizationId) {
        throw new Error(
          `no organization holds project ${PROJECT_ID}; check LANGY_PROJECT_ID`,
        );
      }
      let refusal = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const created = await trpcMutate<{ token: string }>({
          cookie,
          path: "apiKey.create",
          input: {
            organizationId,
            name: `langy-local-control-e2e ${new Date().toISOString()}`,
            keyType: "personal",
            permissionMode: "all",
            bindings: [
              { role: "ADMIN", scopeType: "PROJECT", scopeId: PROJECT_ID },
            ],
          },
        });
        refusal = await keyRefusal(created.token);
        if (refusal === "") return created.token;
        console.log(`[fixture] minted key refused, minting again: ${refusal}`);
      }
      throw new Error(
        `every minted key was refused by the control route: ${refusal}`,
      );
    } catch (error) {
      cliApiKeyPromise = null;
      throw error;
    }
  })();
  return cliApiKeyPromise;
}

/**
 * Empty when the key reaches the control route, otherwise the words the
 * platform refused it with. The list read needs the same permission the
 * command line needs, so it is the cheapest proof the key carries it.
 */
async function keyRefusal(token: string): Promise<string> {
  try {
    const response = await fetch(`${APP_BASE}/api/v1/langy/control/requests`, {
      headers: { "X-Auth-Token": token, "X-Project-Id": PROJECT_ID },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return "";
    return `${response.status} ${(await response.text()).slice(0, 200)}`;
  } catch (error) {
    return String(error);
  }
}

// ---------------------------------------------------------------------------
// The temporary repository
// ---------------------------------------------------------------------------

/** The repository the scenario shares, and the reads the assertions make. */
export interface DemoRepo {
  root: string;
  language: DemoLanguage;
  /** Every local branch name. */
  branches: () => string[];
  /** The branch that is checked out. */
  currentBranch: () => string;
  /** The subject line of every commit, newest first. */
  log: () => string[];
  /** The diff of one branch against `main`. */
  diffAgainstMain: (branch: string) => string;
  /** The porcelain status, so a test can prove the tree was left clean. */
  status: () => string;
  read: (relativePath: string) => string;
  exists: (relativePath: string) => boolean;
  /** Any git command, for a read a helper above does not cover. */
  git: (args: string[]) => string;
}

async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    if (SKIPPED_ENTRIES.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(source, target);
    } else if (entry.isSymbolicLink()) {
      await fs.symlink(await fs.readlink(source), target);
    } else {
      await fs.copyFile(source, target);
    }
  }
}

/**
 * Point the demo's LangWatch SDK dependency at this checkout by absolute path.
 *
 * Both applications depend on the SDK through a relative path that only
 * resolves inside the monorepo (`../../../../sdks/python`,
 * `file:../../../../sdks/typescript`). A copy outside it must name the same
 * SDK by its absolute path, or the install fails and the scenario measures the
 * fixture rather than the product.
 */
async function pointSdkAtThisCheckout({
  root,
  language,
}: {
  root: string;
  language: DemoLanguage;
}): Promise<void> {
  if (language === "python") {
    const file = path.join(root, "pyproject.toml");
    const source = await fs.readFile(file, "utf8");
    await fs.writeFile(
      file,
      source.replace(
        /path\s*=\s*"[^"]*sdks\/python"/,
        `path = "${path.join(REPO_ROOT, "sdks", "python")}"`,
      ),
      "utf8",
    );
    return;
  }
  const file = path.join(root, "package.json");
  const manifest = JSON.parse(await fs.readFile(file, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  if (manifest.dependencies?.langwatch) {
    manifest.dependencies.langwatch = `file:${path.join(
      REPO_ROOT,
      "sdks",
      "typescript",
    )}`;
  }
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * A demo application as its own git repository, on `main`, with one commit.
 *
 * The install is what makes the folder real: Langy runs the project's own
 * checks on it, and a folder with no dependencies would push it into
 * installing them itself and grade the wrong thing.
 */
export async function createDemoRepo({
  language,
  name,
  install = true,
}: {
  language: DemoLanguage;
  /** Names the folder, so a failed run is readable on disk. */
  name: string;
  install?: boolean;
}): Promise<DemoRepo> {
  const root = path.join(
    SCENARIO_REPO_DIR,
    `${name}-${Date.now().toString(36)}`,
  );
  await fs.rm(root, { recursive: true, force: true });
  await copyTree(DEMO_SOURCE[language], root);
  await pointSdkAtThisCheckout({ root, language });

  const git = (args: string[]): string => sh("git", args, { cwd: root });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "LangWatch scenario"]);
  git(["config", "user.email", "scenario@langwatch.localhost"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["add", "-A"]);
  git(["commit", "-m", "chore: the ACME support agent"]);

  if (install) {
    if (language === "python") {
      sh("uv", ["sync"], { cwd: root, timeoutMs: 600_000 });
    } else {
      sh("npm", ["install", "--no-audit", "--no-fund"], {
        cwd: root,
        timeoutMs: 600_000,
      });
    }
  }

  return {
    root,
    language,
    branches: () =>
      git(["for-each-ref", "--format=%(refname:short)", "refs/heads"])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    currentBranch: () => git(["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
    log: () =>
      git(["log", "--all", "--pretty=%s"])
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    diffAgainstMain: (branch: string) => git(["diff", `main...${branch}`]),
    status: () => git(["status", "--porcelain"]),
    read: (relativePath: string) =>
      existsSync(path.join(root, relativePath))
        ? readFileSync(path.join(root, relativePath), "utf8")
        : "",
    exists: (relativePath: string) => existsSync(path.join(root, relativePath)),
    git,
  };
}

// ---------------------------------------------------------------------------
// The command line, in a terminal
// ---------------------------------------------------------------------------

/** Where the built command line lives once the SDK is bundled. */
const CLI_ENTRY = path.join(
  REPO_ROOT,
  "sdks",
  "typescript",
  "dist",
  "cli",
  "index.js",
);

let cliBuildPromise: Promise<void> | null = null;

/**
 * Build the command line once per test process.
 *
 * `tsup` is called rather than the package's `build` script because that
 * script runs a whole-tree `tsc --noEmit` first, which is the repository's
 * typecheck job and not this suite's. `LANGY_SKIP_CLI_BUILD=1` reuses whatever
 * is in `dist` already, for a quick re-run of a scenario.
 */
export function buildCli(): Promise<void> {
  cliBuildPromise ??= (async () => {
    try {
      if (process.env.LANGY_SKIP_CLI_BUILD === "1" && existsSync(CLI_ENTRY)) {
        return;
      }
      sh("pnpm", ["--filter", "langwatch", "exec", "tsup"], {
        cwd: REPO_ROOT,
        timeoutMs: 600_000,
      });
      if (!existsSync(CLI_ENTRY)) {
        throw new Error(`the CLI build produced no ${CLI_ENTRY}`);
      }
    } catch (error) {
      cliBuildPromise = null;
      throw error;
    }
  })();
  return cliBuildPromise;
}

/** The terminal the command line runs in, and the ways a test drives it. */
export interface CliTerminal {
  sessionName: string;
  /** Everything the terminal has shown so far. */
  capture: () => string;
  /** Wait until the terminal shows this text, then answer with the capture. */
  waitForText: (
    pattern: string | RegExp,
    timeoutMs?: number,
  ) => Promise<string>;
  sendKeys: (...keys: string[]) => void;
  /** Wait for the approve question and answer it with Approve. */
  approve: (timeoutMs?: number) => Promise<void>;
  /** Ctrl-C twice, which is how a developer stops sharing. */
  disconnect: () => Promise<void>;
  isRunning: () => boolean;
  /** Kill the terminal whatever state it is in. */
  stop: () => void;
}

/**
 * Cancels every control request still open for this project.
 *
 * A request a run never answered stays open for its whole window, and the next
 * `langwatch langy --share-control` then opens the picker instead of waiting.
 * Every scenario shares one project, so one run's leftovers change what the
 * next run's command line does. Clearing them first is what a developer with
 * one live conversation sees.
 */
export async function cancelOpenControlRequests(): Promise<void> {
  const apiKey = await getCliApiKey();
  const headers = {
    "X-Auth-Token": apiKey,
    "X-Project-Id": PROJECT_ID,
    "Content-Type": "application/json",
  };
  const listed = await fetch(`${APP_BASE}/api/v1/langy/control/requests`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!listed.ok) return;
  const body = (await listed.json()) as { requests?: Array<{ id: string }> };
  for (const request of body.requests ?? []) {
    await fetch(
      `${APP_BASE}/api/v1/langy/control/requests/${encodeURIComponent(request.id)}/cancel`,
      { method: "POST", headers, signal: AbortSignal.timeout(30_000) },
    ).catch(() => undefined);
  }
}

/**
 * Start `langwatch langy --share-control` in the folder, in its own terminal.
 *
 * The command line waits when no request is open, so a scenario can start it
 * before the ask or after it and the order does not matter.
 */
export async function startShareControl({
  repo,
  label,
}: {
  repo: DemoRepo;
  label: string;
}): Promise<CliTerminal> {
  await buildCli();
  await cancelOpenControlRequests();
  const apiKey = await getCliApiKey();
  const sessionName = `langy-${label}-${Date.now().toString(36)}`;
  const configPath = path.join(repo.root, "..", `${sessionName}-config.json`);
  const script = path.join(repo.root, "..", `${sessionName}.sh`);
  await fs.writeFile(
    script,
    [
      "#!/bin/bash",
      `cd ${JSON.stringify(repo.root)}`,
      `export LANGWATCH_ENDPOINT=${JSON.stringify(APP_BASE)}`,
      `export LANGWATCH_API_KEY=${JSON.stringify(apiKey)}`,
      `export LANGWATCH_CLI_CONFIG=${JSON.stringify(configPath)}`,
      "export FORCE_COLOR=0",
      "unset TRACEPARENT",
      `exec node ${JSON.stringify(CLI_ENTRY)} langy --share-control`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );

  sh("tmux", [
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-x",
    "200",
    "-y",
    "60",
    "bash",
    script,
  ]);

  // Everything the terminal prints, kept on disk. tmux ends the session with
  // the process and takes the last screen with it, so the goodbye line a test
  // asserts on would otherwise be gone before it could be read.
  const paneLog = path.join(repo.root, "..", `${sessionName}.log`);
  sh("tmux", [
    "pipe-pane",
    "-o",
    "-t",
    sessionName,
    `cat >> ${JSON.stringify(paneLog)}`,
  ]);

  // tmux ends the session with the process, and capture-pane on a session that
  // is gone answers nothing. The last text the terminal showed is what a test
  // asserts on after the command line exits, so every successful capture is
  // remembered and served once the session is gone.
  const readPaneLog = (): string => {
    try {
      return readFileSync(paneLog, "utf8");
    } catch {
      return "";
    }
  };
  const capture = (): string => {
    const result = spawnSync(
      "tmux",
      ["capture-pane", "-p", "-t", sessionName, "-S", "-3000"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    const pane = result.stdout ?? "";
    const logged = readPaneLog();
    // The live pane reads best while the session is there; once it is gone the
    // log is the only copy, and it is also the only place the last lines
    // before the exit survive.
    if (pane.trim() === "") return logged;
    return logged.includes("Leaving") ? `${pane}\n${logged}` : pane;
  };
  const isRunning = (): boolean =>
    spawnSync("tmux", ["has-session", "-t", sessionName]).status === 0;
  const sendKeys = (...keys: string[]): void => {
    spawnSync("tmux", ["send-keys", "-t", sessionName, ...keys]);
  };
  const waitForText = async (
    pattern: string | RegExp,
    timeoutMs = 120_000,
  ): Promise<string> =>
    waitFor({
      what: `the terminal to show ${String(pattern)}`,
      timeoutMs,
      intervalMs: 750,
      read: () => {
        const text = capture();
        const seen =
          typeof pattern === "string"
            ? text.includes(pattern)
            : pattern.test(text);
        return seen ? text : null;
      },
    });

  const terminal: CliTerminal = {
    sessionName,
    capture,
    waitForText,
    sendKeys,
    approve: async (timeoutMs = 240_000) => {
      await waitForText("Share this folder?", timeoutMs);
      // The picker opens on Approve, so Enter is the whole answer. A short
      // pause first: the prompt paints before it listens.
      await sleep(500);
      sendKeys("Enter");
      await waitForText("Connected", 60_000);
    },
    disconnect: async () => {
      if (!isRunning()) return;
      sendKeys("C-c");
      await sleep(1_500);
      if (isRunning()) sendKeys("C-c");
      await waitFor({
        what: "the command line to exit",
        timeoutMs: 30_000,
        intervalMs: 500,
        read: () => !isRunning(),
      }).catch(() => undefined);
    },
    isRunning,
    stop: () => {
      spawnSync("tmux", ["kill-session", "-t", sessionName]);
    },
  };
  await terminal.waitForText(
    /Waiting for a Langy conversation|Share this folder\?/,
    120_000,
  );
  return terminal;
}

// ---------------------------------------------------------------------------
// Answering the cards as the user
// ---------------------------------------------------------------------------

/** One permission card the panel showed, and what the fixture answered. */
export interface PermissionAsk {
  waitId: string;
  callId: string;
  summary: string;
  pattern: string;
  reason: string;
  skipOffered: boolean;
  decision: "allow_once" | "allow_pattern" | "deny";
  turnId: string;
  askedAt: number;
}

/** One question card the panel showed, and what the fixture answered. */
export interface QuestionAsk {
  waitId: string;
  questions: Array<{ question: string; options?: Array<{ label: string }> }>;
  answered: Array<{ question: string; selected: string[] }>;
  turnId: string;
}

/** How the fixture answers permission cards, in the order it reads the rules. */
export interface PermissionPolicy {
  /** Deny a card whose summary matches one of these. */
  deny?: RegExp[];
  /** Answer "allow for this session" for a card whose summary matches. */
  allowPattern?: RegExp[];
  /** Everything else. */
  fallback?: "allow_once" | "deny";
}

/** Picks the answer to one question card. Default: the first option. */
export type QuestionAnswerPicker = (question: {
  question: string;
  options?: Array<{ label: string }>;
}) => string[];

/** One message in the shape the scenario judge reads. */
export type JudgeMessage =
  | { role: "assistant"; content: string }
  | {
      role: "assistant";
      content: Array<
        | { type: "text"; text: string }
        | {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            input: unknown;
          }
      >;
    }
  | {
      role: "tool";
      content: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: { type: "text" | "error-text"; value: string };
      }>;
    };

/** What the watcher saw on the conversation, and what it answered. */
export interface ConversationWatcher {
  permissions: PermissionAsk[];
  questions: QuestionAsk[];
  /** `connected` and `disconnected` entries, in order. */
  workspaceEvents: Array<{ state: string; name: string; root: string }>;
  /** Every turn the watcher observed, in the order it observed them. */
  turnIds: string[];
  /** The turns the panel started on its own, without a message from the test. */
  turnsStartedWithoutUs: (knownTurnIds: string[]) => string[];
  /** Wait for a turn other than the ones already known. */
  waitForNewTurn: (input: {
    knownTurnIds: string[];
    timeoutMs?: number;
  }) => Promise<string>;
  /**
   * Wait until no turn is in flight.
   *
   * Idle says the turn ended, not that its answer is already readable: the
   * fold and the message projection consume the same event on separate
   * queues, so `currentTurnId` can be null a moment before the answer row
   * exists. Ask for a turn's own messages with `turnId`, which waits for it.
   */
  waitForIdle: (timeoutMs?: number) => Promise<void>;
  /** The whole conversation, as the panel would render it. */
  transcript: () => Promise<string>;
  /**
   * The text of one turn's answer, or of the last answer stored when no turn
   * is named.
   */
  lastAssistantText: (input?: {
    turnId?: string;
    timeoutMs?: number;
  }) => Promise<string>;
  /**
   * One turn's answer as a judge reads it: the tool calls it made and what
   * they answered, then its reply.
   *
   * A turn the panel starts on its own never passes through the scenario
   * adapter, so nothing else puts its work in front of the judge. Feeding only
   * the reply leaves every claim in it looking ungrounded, which is a fact
   * about the harness and not about the answer.
   *
   * Name the turn with `turnId`. Without it the read takes whatever answer is
   * last right now, which after a turn that just ended can still be the answer
   * before it.
   */
  lastTurnMessages: (input?: {
    turnId?: string;
    timeoutMs?: number;
  }) => Promise<JudgeMessage[]>;
  stop: () => void;
}

/** One message of the stored conversation, as `langy.messages` returns it. */
export interface StoredMessage {
  id: string;
  role: string;
  parts: Array<Record<string, unknown>>;
}

/**
 * The stored answer of one turn.
 *
 * The answer message of a turn carries the turn id inside its own message id,
 * which is how the product keeps a turn's finalize idempotent. That is the one
 * link between a turn and its stored answer, so a read can wait for the right
 * message instead of taking whichever answer is last.
 */
export function answerOfTurn(
  messages: StoredMessage[],
  turnId: string,
): StoredMessage | null {
  return (
    messages.find(
      (message) => message.role === "assistant" && message.id.endsWith(turnId),
    ) ?? null
  );
}

interface StreamEntry {
  type?: string;
  [key: string]: unknown;
}

/**
 * Reads one turn's live stream and reports its entries.
 *
 * The suite's adapter already reads the stream of the turn it started, but a
 * folder that connects starts the NEXT turn on its own, and that turn's cards
 * have to be answered too. A second reader on the same turn is harmless: the
 * subscription is a read, and every answer is keyed on its wait id.
 */
async function readTurnEntries({
  cookie,
  conversationId,
  turnId,
  onEntry,
  signal,
}: {
  cookie: string;
  conversationId: string;
  turnId: string;
  onEntry: (entry: StreamEntry) => void;
  signal: AbortSignal;
}): Promise<void> {
  const input = encodeURIComponent(
    JSON.stringify({ json: { projectId: PROJECT_ID, conversationId, turnId } }),
  );
  const response = await fetch(
    `${APP_BASE}/api/sse/langy.onTurnStream?input=${input}`,
    {
      headers: { Cookie: cookie, Accept: "text/event-stream" },
      signal,
    },
  );
  if (!response.ok || !response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const handleFrame = (frame: string): void => {
    for (const line of frame.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const entry = JSON.parse(payload).json as StreamEntry;
        if (entry && typeof entry === "object") onEntry(entry);
      } catch {
        // A frame the suite does not understand is not this suite's business.
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      handleFrame(buffer.slice(0, index));
      buffer = buffer.slice(index + 2);
    }
  }
  if (buffer.trim()) handleFrame(buffer);
}

/**
 * Watch the conversation and answer its cards as the developer would.
 *
 * The watcher polls the conversation for the turn in flight, opens that turn's
 * live stream, and answers every permission and question card it sees. It is
 * the user's hand: nothing it does is available to Langy, and every answer is
 * recorded so a test can assert what was asked before it asks a judge.
 */
export function watchLangyConversation({
  adapter,
  policy = {},
  answerQuestion,
}: {
  adapter: LangyAdapter;
  policy?: PermissionPolicy;
  answerQuestion?: QuestionAnswerPicker;
}): ConversationWatcher {
  const permissions: PermissionAsk[] = [];
  const questions: QuestionAsk[] = [];
  const workspaceEvents: Array<{
    state: string;
    name: string;
    root: string;
  }> = [];
  const turnIds: string[] = [];
  const answeredWaits = new Set<string>();
  const watchedTurns = new Set<string>();
  const controller = new AbortController();
  let stopped = false;

  const decide = (summary: string): "allow_once" | "allow_pattern" | "deny" => {
    if ((policy.deny ?? []).some((rule) => rule.test(summary))) return "deny";
    if ((policy.allowPattern ?? []).some((rule) => rule.test(summary))) {
      return "allow_pattern";
    }
    return policy.fallback ?? "allow_once";
  };

  const answerPermission = async (
    entry: StreamEntry,
    turnId: string,
  ): Promise<void> => {
    const waitId = String(entry.waitId ?? "");
    if (!waitId || answeredWaits.has(waitId)) return;
    if (entry.status !== "pending") return;
    answeredWaits.add(waitId);
    const summary = String(entry.summary ?? "");
    const decision = decide(summary);
    permissions.push({
      waitId,
      callId: String(entry.callId ?? ""),
      summary,
      pattern: String(entry.pattern ?? ""),
      reason: String(entry.reason ?? ""),
      skipOffered: entry.skipOffered === true,
      decision,
      turnId,
      askedAt: Date.now(),
    });
    const cookie = await getSessionCookie();
    await trpcMutate({
      cookie,
      path: "langy.answerLocalPermission",
      input: {
        projectId: PROJECT_ID,
        conversationId: adapter.state.conversationId,
        waitId,
        decision,
      },
    }).catch((error) => {
      // A card that settled before the answer is the product's own race, not
      // a fixture failure: record it and let the assertions speak.
      console.log(`[fixture] permission answer refused: ${String(error)}`);
    });
  };

  const answerQuestionCard = async (
    entry: StreamEntry,
    turnId: string,
  ): Promise<void> => {
    const waitId = String(entry.waitId ?? "");
    if (!waitId || answeredWaits.has(waitId)) return;
    if (entry.status !== "pending") return;
    answeredWaits.add(waitId);
    const asked = (
      Array.isArray(entry.questions) ? entry.questions : []
    ) as QuestionAsk["questions"];
    const answers = asked.map((question) => ({
      question: question.question,
      selected:
        answerQuestion?.(question) ??
        (question.options?.[0]?.label ? [question.options[0].label] : []),
    }));
    questions.push({ waitId, questions: asked, answered: answers, turnId });
    const cookie = await getSessionCookie();
    await trpcMutate({
      cookie,
      path: "langy.answerQuestion",
      input: {
        projectId: PROJECT_ID,
        conversationId: adapter.state.conversationId,
        waitId,
        answers,
      },
    }).catch((error) => {
      console.log(`[fixture] question answer refused: ${String(error)}`);
    });
  };

  const watchTurn = (turnId: string): void => {
    if (watchedTurns.has(turnId)) return;
    watchedTurns.add(turnId);
    turnIds.push(turnId);
    void (async () => {
      const cookie = await getSessionCookie();
      await readTurnEntries({
        cookie,
        conversationId: adapter.state.conversationId ?? "",
        turnId,
        signal: controller.signal,
        onEntry: (entry) => {
          if (entry.type === "local_permission") {
            void answerPermission(entry, turnId);
          } else if (entry.type === "question") {
            void answerQuestionCard(entry, turnId);
          } else if (entry.type === "local_workspace") {
            workspaceEvents.push({
              state: String(entry.state ?? ""),
              name: String(entry.name ?? ""),
              root: String(entry.root ?? ""),
            });
          }
        },
      }).catch(() => undefined);
    })();
  };

  const readConversation = async (): Promise<{
    currentTurnId: string | null;
    messages: Array<{
      id: string;
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
  } | null> => {
    const conversationId = adapter.state.conversationId;
    if (!conversationId) return null;
    const cookie = await getSessionCookie();
    return await trpcQuery({
      cookie,
      path: "langy.messages",
      input: { projectId: PROJECT_ID, conversationId },
    });
  };

  void (async () => {
    while (!stopped) {
      try {
        const snapshot = await readConversation();
        if (snapshot?.currentTurnId) watchTurn(snapshot.currentTurnId);
        if (adapter.state.currentTurnId) {
          watchTurn(adapter.state.currentTurnId);
        }
      } catch {
        // The conversation may not exist yet, or the app may be busy.
      }
      await sleep(1_000);
    }
  })();

  const messageText = (message: {
    role: string;
    parts: Array<Record<string, unknown>>;
  }): string =>
    message.parts
      .filter((part) => typeof part.text === "string")
      .map((part) => String(part.text))
      .join("\n");

  /**
   * One stored message as the judge reads it: the tool calls and their results
   * as their own messages, then the reply. The part type carries the tool name
   * as `tool-<name>`, which is the panel's own shape.
   */
  const judgeMessagesOf = (message: {
    role: string;
    parts: Array<Record<string, unknown>>;
  }): JudgeMessage[] => {
    const calls = message.parts.filter(
      (part) =>
        typeof part.type === "string" &&
        part.type.startsWith("tool-") &&
        typeof part.toolCallId === "string",
    );
    const text = messageText(message);
    if (calls.length === 0) return [{ role: "assistant", content: text }];
    return [
      {
        role: "assistant",
        content: calls.map((part) => ({
          type: "tool-call" as const,
          toolCallId: String(part.toolCallId),
          toolName: String(part.type).slice("tool-".length),
          input: part.input,
        })),
      },
      {
        role: "tool",
        content: calls.map((part) => ({
          type: "tool-result" as const,
          toolCallId: String(part.toolCallId),
          toolName: String(part.type).slice("tool-".length),
          output: {
            type:
              part.state === "output-error"
                ? ("error-text" as const)
                : ("text" as const),
            value:
              typeof part.output === "string"
                ? part.output
                : JSON.stringify(part.output ?? ""),
          },
        })),
      },
      { role: "assistant", content: text },
    ];
  };

  const lastAnswer = async (): Promise<StoredMessage | null> => {
    const snapshot = await readConversation();
    const assistant = ((snapshot?.messages ?? []) as StoredMessage[]).filter(
      (message) => message.role === "assistant",
    );
    return assistant[assistant.length - 1] ?? null;
  };

  /**
   * Read a turn's answer, waiting for it to be stored.
   *
   * A turn that has just gone idle may have no answer row yet: the fold that
   * clears `currentTurnId` and the projection that writes the message consume
   * the same event on separate queues.
   */
  const readTurnAnswer = async ({
    turnId,
    timeoutMs = 60_000,
  }: {
    turnId?: string;
    timeoutMs?: number;
  }): Promise<StoredMessage | null> => {
    if (!turnId) return await lastAnswer();
    try {
      return await waitFor({
        what: `the stored answer of turn ${turnId}`,
        timeoutMs,
        intervalMs: 1_000,
        read: async () => {
          const snapshot = await readConversation();
          return answerOfTurn(
            (snapshot?.messages ?? []) as StoredMessage[],
            turnId,
          );
        },
      });
    } catch (error) {
      // A turn that failed stores no answer of its own. The last answer is
      // then the best the judge can be given, which is what this read did
      // before it could name a turn.
      console.log(`[fixture] no stored answer for ${turnId}: ${String(error)}`);
      return await lastAnswer();
    }
  };

  return {
    permissions,
    questions,
    workspaceEvents,
    turnIds,
    turnsStartedWithoutUs: (knownTurnIds) =>
      turnIds.filter((id) => !knownTurnIds.includes(id)),
    waitForNewTurn: async ({ knownTurnIds, timeoutMs = 240_000 }) =>
      waitFor({
        what: "a turn the panel started on its own",
        timeoutMs,
        read: () => turnIds.find((id) => !knownTurnIds.includes(id)) ?? null,
      }),
    waitForIdle: async (timeoutMs = 600_000) => {
      // A turn that has not started yet also reads as idle, so the wait first
      // asks for one moment of work and only then for quiet.
      await waitFor({
        what: "the conversation to go idle",
        timeoutMs,
        intervalMs: 2_000,
        read: async () => {
          const snapshot = await readConversation();
          return snapshot !== null && snapshot.currentTurnId === null;
        },
      });
    },
    transcript: async () => {
      const snapshot = await readConversation();
      return (snapshot?.messages ?? [])
        .map((message) => `### ${message.role}\n\n${messageText(message)}`)
        .join("\n\n");
    },
    lastAssistantText: async (input = {}) => {
      const answer = await readTurnAnswer(input);
      return answer ? messageText(answer) : "";
    },
    lastTurnMessages: async (input = {}) => {
      const answer = await readTurnAnswer(input);
      if (!answer) return [];
      return judgeMessagesOf(answer);
    },
    stop: () => {
      stopped = true;
      controller.abort();
    },
  };
}

// ---------------------------------------------------------------------------
// The conversation's own local-control state
// ---------------------------------------------------------------------------

export interface LocalWorkspaceStatus {
  connected: boolean;
  workspace: { root?: string; name?: string; hostname?: string } | null;
  skipAllowed: boolean;
  skipPermissions: boolean;
  pendingRequest: { id: string; expiresAt: string } | null;
  codeAccessPreference: "github" | null;
}

/** What the panel chip and the code access card read. */
export async function getLocalWorkspace(
  conversationId: string,
): Promise<LocalWorkspaceStatus> {
  const cookie = await getSessionCookie();
  return await trpcQuery<LocalWorkspaceStatus>({
    cookie,
    path: "langy.getLocalWorkspace",
    input: { projectId: PROJECT_ID, conversationId },
  });
}

/** Remember, or forget, how Langy reaches this person's code. */
export async function setCodeAccessPreference(
  preference: "github" | null,
): Promise<void> {
  const cookie = await getSessionCookie();
  await trpcMutate({
    cookie,
    path: "langy.setCodeAccessPreference",
    input: { projectId: PROJECT_ID, preference },
  });
}

/** Close the shared folder the way the panel header chip closes it. */
export async function disconnectLocalWorkspace(
  conversationId: string,
): Promise<void> {
  const cookie = await getSessionCookie();
  await trpcMutate({
    cookie,
    path: "langy.disconnectLocalWorkspace",
    input: { projectId: PROJECT_ID, conversationId },
  });
}

/** Wait until the conversation records the control request the card renders. */
export async function waitForPendingRequest({
  conversationId,
  timeoutMs = 300_000,
}: {
  conversationId: string;
  timeoutMs?: number;
}): Promise<{ id: string; expiresAt: string }> {
  return await waitFor({
    what: "the code access card's control request",
    timeoutMs,
    read: async () => (await getLocalWorkspace(conversationId)).pendingRequest,
  });
}

/** Wait until the folder is connected to the conversation. */
export async function waitForConnectedWorkspace({
  conversationId,
  timeoutMs = 300_000,
}: {
  conversationId: string;
  timeoutMs?: number;
}): Promise<LocalWorkspaceStatus> {
  return await waitFor({
    what: "the folder to connect to the conversation",
    timeoutMs,
    read: async () => {
      const status = await getLocalWorkspace(conversationId);
      return status.connected ? status : null;
    },
  });
}

// ---------------------------------------------------------------------------
// The demo application, running
// ---------------------------------------------------------------------------

/** A free TCP port, so two runs never fight over one. */
export async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Keeps one entry out of the repository through git's own exclude file, so
 * the demo's `.gitignore` stays exactly as it ships and Langy never commits
 * the credentials the fixture wrote.
 */
async function excludeFromGit({
  root,
  entry,
}: {
  root: string;
  entry: string;
}): Promise<void> {
  const excludeFile = path.join(root, ".git", "info", "exclude");
  await fs.mkdir(path.dirname(excludeFile), { recursive: true });
  const current = existsSync(excludeFile)
    ? await fs.readFile(excludeFile, "utf8")
    : "";
  if (current.split("\n").some((line) => line.trim() === entry)) return;
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  await fs.appendFile(excludeFile, `${separator}${entry}\n`, "utf8");
}

/** The demo application, running from the shared folder. */
export interface DemoApp {
  port: number;
  sessionName: string;
  logPath: string;
  capture: () => string;
  stop: () => void;
}

/**
 * Start the demo application from the shared folder, connected to the platform.
 *
 * It runs in its own terminal rather than as a child of the test, because
 * Langy restarts it through the folder and the test must not own the process
 * it is asserting about.
 *
 * The credentials go in the folder's own `.env`, which is where a developer
 * keeps them and where the demo reads them from. Exporting them only in this
 * launcher would leave them out of the shell Langy restarts the application
 * in, so the new process would come up with no way to reach the platform and
 * the agent would never register the change.
 */
export async function startDemoApp({
  repo,
  label,
  port,
}: {
  repo: DemoRepo;
  label: string;
  port?: number;
}): Promise<DemoApp> {
  const apiKey = await getCliApiKey();
  const chosenPort = port ?? (await freePort());
  await fs.writeFile(
    path.join(repo.root, ".env"),
    [
      `LANGWATCH_ENDPOINT=${APP_BASE}`,
      `LANGWATCH_API_KEY=${apiKey}`,
      "LANGWATCH_AGENT_CONNECT=1",
      "",
    ].join("\n"),
    "utf8",
  );
  await excludeFromGit({ root: repo.root, entry: ".env" });
  const sessionName = `acme-${label}-${Date.now().toString(36)}`;
  const logPath = path.join(repo.root, "..", `${sessionName}.log`);
  const command =
    repo.language === "python"
      ? `uv run uvicorn app.main:app --port ${chosenPort}`
      : `npm run start`;
  const script = path.join(repo.root, "..", `${sessionName}.sh`);
  await fs.writeFile(
    script,
    [
      "#!/bin/bash",
      `cd ${JSON.stringify(repo.root)}`,
      `export LANGWATCH_ENDPOINT=${JSON.stringify(APP_BASE)}`,
      `export LANGWATCH_API_KEY=${JSON.stringify(apiKey)}`,
      "export LANGWATCH_AGENT_CONNECT=1",
      `export PORT=${chosenPort}`,
      "unset TRACEPARENT",
      `exec ${command} 2>&1 | tee ${JSON.stringify(logPath)}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 },
  );
  sh("tmux", [
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-x",
    "200",
    "-y",
    "60",
    "bash",
    script,
  ]);
  const capture = (): string =>
    spawnSync(
      "tmux",
      ["capture-pane", "-p", "-t", sessionName, "-S", "-3000"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ).stdout ?? "";
  return {
    port: chosenPort,
    sessionName,
    logPath,
    capture,
    stop: () => {
      spawnSync("tmux", ["kill-session", "-t", sessionName]);
    },
  };
}

/** The agents this project has registered, read back over the public API. */
export async function readAgent(name: string): Promise<{
  id: string;
  name: string;
  parameters?: unknown;
} | null> {
  // The demo registers with the key this fixture minted, and that key owns
  // the agent it creates: a connection made with a project key is a different
  // identity and a different row. Reading with the project key from the
  // environment would find that other row, which no run of this suite ever
  // touches, and report the parameters it had months ago.
  const apiKey = await getCliApiKey();
  const response = await fetch(`${APP_BASE}/api/v1/agents`, {
    headers: { "X-Auth-Token": apiKey, "X-Project-Id": PROJECT_ID },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as unknown;
  const rows = Array.isArray(body)
    ? body
    : ((body as { agents?: unknown[]; data?: unknown[] }).agents ??
      (body as { data?: unknown[] }).data ??
      []);
  const named = (
    rows as Array<{
      id: string;
      name: string;
      parameters?: unknown;
      lastSeenAt?: string;
    }>
  ).filter((agent) => agent.name === name);
  // A folder shared from another machine leaves its own row behind, so the
  // newest connection is the one this run is asserting about.
  return (
    named.sort(
      (left, right) =>
        Date.parse(right.lastSeenAt ?? "") - Date.parse(left.lastSeenAt ?? ""),
    )[0] ?? null
  );
}

/** Everything a scenario opened, closed in the order that leaves nothing behind. */
export async function teardown({
  terminal,
  watcher,
  app,
}: {
  terminal?: CliTerminal;
  watcher?: ConversationWatcher;
  app?: DemoApp;
}): Promise<void> {
  app?.stop();
  watcher?.stop();
  if (terminal) {
    await terminal.disconnect().catch(() => undefined);
    terminal.stop();
  }
}

/** The terminal capture, for the scenario transcript. */
export function terminalSection(terminal: CliTerminal): string {
  return ["## Terminal", "", "```", terminal.capture().trim(), "```"].join(
    "\n",
  );
}

/** Best-effort note in the log when the machine has no `uv` or no `tmux`. */
export function assertToolsPresent(): void {
  for (const tool of ["tmux", "git", "node"]) {
    if (spawnSync("which", [tool]).status !== 0) {
      throw new Error(
        `${tool} is not on PATH; the local control scenarios drive the real command line and need it`,
      );
    }
  }
}
