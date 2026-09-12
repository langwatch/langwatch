/**
 * The committed launcher against the built CLI, run the way Claude Code runs
 * it: a real process, a real payload on its stdin, a real git checkout to
 * describe and a real collector to reach.
 *
 * Integration rather than unit on purpose. What the hook REPORTS is covered
 * beside the command (specs/ai-governance/cli-wrappers/session-context-hook
 * .feature) and how the launcher RESOLVES the CLI is covered by
 * launcher.unit.test.ts against fakes. What has no coverage anywhere else is
 * the pair: whether the launcher, handed the CLI dist as it ships, gets a
 * session context record to a collector, gets the guidance JSON to stdout,
 * and says the right thing when there is no CLI at all.
 *
 * Every case runs with an explicitly constructed environment rather than an
 * extension of this process's own. These tests are frequently run FROM a coding
 * agent, whose variables would otherwise decide the outcome: `CLAUDECODE` would
 * defeat the misattribution case, `TRACEPARENT` would attach a trace context
 * nothing asked for, and `HOME` would put the developer's own credentials and
 * fingerprint files in front of the scratch ones.
 *
 * Spec: specs/ai-governance/agent-plugin/plugin-package.feature
 */

import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(pluginRoot, "..", "..");
const launcher = join(pluginRoot, "scripts", "launch.mjs");
const cliEntry = join(repoRoot, "sdks", "typescript", "dist", "cli", "index.js");

/** The ingest key the hook authorizes the post with, per agent. */
const INGEST_KEY = "sk-lw-plugin-integration-test";

/** What the collector answered, one entry per request that reached it. */
interface CapturedRequest {
  path: string;
  authorization: string | undefined;
  body: string;
}

interface HookRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

let collector: Server;
let collectorUrl: string;
let received: CapturedRequest[] = [];
let scratch: string;

/** Where the CLI config and the fingerprint state live for one case. */
let home: string;

const startCollector = async (): Promise<void> => {
  collector = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });

  await new Promise<void>((resolve) => {
    collector.listen(0, "127.0.0.1", resolve);
  });

  const address = collector.address();
  if (address === null || typeof address === "string") {
    throw new Error("the collector did not bind a TCP port");
  }
  collectorUrl = `http://127.0.0.1:${address.port}`;
};

/** A git checkout with an origin remote, which is what the hook can describe. */
const makeRepository = (name: string): string => {
  const repository = join(scratch, name);
  mkdirSync(repository, { recursive: true });

  const git = (...args: string[]): void => {
    execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
  };

  git("init", "--initial-branch=main");
  git("config", "user.email", "plugin-test@langwatch.test");
  git("config", "user.name", "Plugin Test");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", "https://github.com/acme/widgets.git");
  git("commit", "--allow-empty", "-m", "init");

  return repository;
};

/**
 * The config a signed-in CLI leaves behind, with the location record `langwatch
 * login` writes pointing at the built dist, so the launcher's first lookup is
 * the one exercised.
 */
const writeCliConfig = ({ signedIn = true }: { signedIn?: boolean } = {}): void => {
  mkdirSync(join(home, ".langwatch"), { recursive: true });
  writeFileSync(
    join(home, ".langwatch", "config.json"),
    JSON.stringify({
      ...(signedIn
        ? {
            control_plane_url: collectorUrl,
            default_personal_ingest_keys: { claude_code: { secret: INGEST_KEY } },
          }
        : {}),
      cli_location: { node: process.execPath, entry: cliEntry },
    }),
    { mode: 0o600 },
  );
};

/**
 * A `langwatch` on PATH that runs the built dist, for the cases where the
 * config carries no location record: the shape a global npm install has.
 */
const cliOnPath = (): string => {
  const bin = join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, "langwatch");
  writeFileSync(script, `#!/bin/sh\nexec "${process.execPath}" "${cliEntry}" "$@"\n`);
  chmodSync(script, 0o755);
  return bin;
};

/**
 * Run the launcher exactly as the plugin's `hooks.json` does, minus the shell:
 * one `node` process, the hook event as its only argument, the payload on
 * stdin. `PATH` carries git (the CLI shells out to it) plus whatever the case
 * added, and never node's own directory: a global npm install puts
 * `langwatch` right beside node, which is the one thing the no-CLI case must
 * not find by accident. The dist is always run by absolute path.
 */
const runHook = ({
  hook,
  payload,
  env,
  path = [],
}: {
  hook: "session-context" | "session-guidance";
  payload: unknown;
  env: Record<string, string>;
  path?: string[];
}): Promise<HookRun> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, hook], {
      cwd: scratch,
      env: {
        PATH: [...path, dirname(gitPath)].join(":"),
        HOME: home,
        // The daemon would serve the guidance command from a process whose
        // stdout is not this hook's; the CLI denies it anyway, and this keeps
        // a scratch HOME from spawning one that outlives the test.
        LANGWATCH_NO_DAEMON: "1",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });

    child.stdin.end(JSON.stringify(payload));
  });

const gitPath = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

/**
 * The collector answers in another process, so a request can still be in flight
 * when the hook has already exited. Give it a moment before concluding nothing
 * was sent, otherwise the silent cases would pass for the wrong reason.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 250));

const sessionStart = (cwd: string) => ({
  session_id: "session-abc",
  cwd,
  hook_event_name: "SessionStart",
});

beforeAll(async () => {
  if (!existsSync(cliEntry)) {
    execFileSync("pnpm", ["--filter", "langwatch", "run", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
      timeout: 300_000,
    });
  }
  await startCollector();
}, 320_000);

afterAll(async () => {
  await new Promise<void>((resolve) => collector.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  scratch = mkdtempSync(join(tmpdir(), "langwatch-plugin-"));
  home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("the launcher running the session context hook", () => {
  describe("given a signed-in CLI and a session inside a git repository", () => {
    /** @scenario "A session in a git repository reports its context once" */
    it("posts one record and leaves the session's output untouched", async () => {
      writeCliConfig();
      const repository = makeRepository("widgets");

      const run = await runHook({
        hook: "session-context",
        payload: sessionStart(repository),
        env: { CLAUDECODE: "1" },
      });
      await settle();

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stderr).toBe("");
      expect(received).toHaveLength(1);

      const request = received[0]!;
      expect(request.path).toBe("/api/otel/v1/logs");
      expect(request.authorization).toBe(`Bearer ${INGEST_KEY}`);

      const record = JSON.parse(request.body) as {
        resourceLogs: Array<{
          scopeLogs: Array<{
            logRecords: Array<{
              eventName: string;
              attributes: Array<{ key: string; value: { stringValue: string } }>;
            }>;
          }>;
        }>;
      };
      const logRecord = record.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];
      expect(logRecord?.eventName).toBe("langwatch.session_context");

      const attributes = Object.fromEntries(
        (logRecord?.attributes ?? []).map((a) => [a.key, a.value.stringValue]),
      );
      expect(attributes["session.id"]).toBe("session-abc");
      expect(attributes["coding_agent.name"]).toBe("claude_code");
      expect(attributes["vcs.repository.host"]).toBe("github.com");
      expect(attributes["vcs.repository.owner"]).toBe("acme");
      expect(attributes["vcs.repository.name"]).toBe("widgets");
      expect(attributes["vcs.ref.head.name"]).toBe("main");

      // The Stop hook of the same session, same context: nothing new to say.
      const again = await runHook({
        hook: "session-context",
        payload: { ...sessionStart(repository), hook_event_name: "Stop" },
        env: { CLAUDECODE: "1" },
      });
      await settle();
      expect(again.exitCode).toBe(0);
      expect(again.stdout).toBe("");
      expect(received).toHaveLength(1);
    });
  });

  describe("given a machine that never signed in but has the CLI on PATH", () => {
    /** @scenario "A session on a machine that never signed in reports nothing" */
    it("sends nothing and exits zero", async () => {
      const repository = makeRepository("widgets");

      const run = await runHook({
        hook: "session-context",
        payload: sessionStart(repository),
        env: { CLAUDECODE: "1" },
        path: [cliOnPath()],
      });
      await settle();

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stderr).toBe("");
      expect(received).toEqual([]);
    });
  });

  describe("given a machine with no CLI anywhere", () => {
    /** @scenario "A session on a machine with no CLI is told once how to install it" */
    it("tells the session once how to install it, then stays quiet", async () => {
      const repository = makeRepository("widgets");

      const first = await runHook({
        hook: "session-context",
        payload: sessionStart(repository),
        env: { CLAUDECODE: "1" },
      });
      await settle();

      expect(first.exitCode).toBe(0);
      expect(first.stderr).toBe("");
      expect(received).toEqual([]);
      const parsed = JSON.parse(first.stdout) as {
        hookSpecificOutput: { hookEventName: string; additionalContext: string };
      };
      expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
      expect(parsed.hookSpecificOutput.additionalContext).toContain("not installed");
      expect(parsed.hookSpecificOutput.additionalContext).toContain("npm install -g langwatch");

      const stop = await runHook({
        hook: "session-context",
        payload: { ...sessionStart(repository), hook_event_name: "Stop" },
        env: { CLAUDECODE: "1" },
      });
      expect(stop.exitCode).toBe(0);
      expect(stop.stdout).toBe("");

      // A restart of the same session: already told.
      const restart = await runHook({
        hook: "session-context",
        payload: sessionStart(repository),
        env: { CLAUDECODE: "1" },
      });
      expect(restart.exitCode).toBe(0);
      expect(restart.stdout).toBe("");
    });
  });

  describe("given another Agent Plugins client that discovered the Claude Code hooks", () => {
    /** @scenario "An agent that is not Claude Code is never reported as Claude Code" */
    it("runs nothing, sends nothing and exits zero", async () => {
      writeCliConfig();
      const repository = makeRepository("widgets");

      const run = await runHook({
        hook: "session-context",
        payload: { ...sessionStart(repository), session_id: "codex-thread-1" },
        env: {},
      });
      await settle();

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stderr).toBe("");
      expect(received).toEqual([]);
    });
  });
});

describe("the launcher running the session guidance hook", () => {
  describe("given a Claude Code session starting with the CLI installed", () => {
    /** @scenario "The plugin's guidance hook emits the guidance as session context" */
    it("emits one JSON object whose additionalContext names the declare command", async () => {
      writeCliConfig({ signedIn: false });

      const run = await runHook({
        hook: "session-guidance",
        payload: sessionStart(scratch),
        env: { CLAUDECODE: "1" },
      });

      expect(run.exitCode).toBe(0);
      expect(run.stderr).toBe("");
      const parsed = JSON.parse(run.stdout) as {
        hookSpecificOutput: { hookEventName: string; additionalContext: string };
      };
      expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
      expect(parsed.hookSpecificOutput.additionalContext).toContain(
        "langwatch ingest context",
      );
    });
  });

  describe("given another Agent Plugins client running the hook", () => {
    it("emits nothing and exits zero", async () => {
      writeCliConfig({ signedIn: false });

      const run = await runHook({
        hook: "session-guidance",
        payload: sessionStart(scratch),
        env: {},
      });

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stderr).toBe("");
    });
  });
});
