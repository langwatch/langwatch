/**
 * The bundled hook script, run the way Claude Code runs it: a real process, a
 * real payload on its stdin, a real git checkout to describe and a real
 * collector to reach.
 *
 * Integration rather than unit on purpose. The unit coverage of what the hook
 * REPORTS already exists beside the command
 * (specs/ai-governance/cli-wrappers/session-context-hook.feature). What has no
 * coverage anywhere else is the bundle: whether a single minified file, cut
 * loose from node_modules and executed by whatever `node` the user has, still
 * finds the config, still shells out to git, still posts, and still leaves the
 * session's stdout untouched. Nothing short of spawning it observes that.
 *
 * Every case runs with an explicitly constructed environment rather than an
 * extension of this process's own. These tests are frequently run FROM a coding
 * agent, whose variables would otherwise decide the outcome: `CLAUDECODE` would
 * defeat the misattribution case, `TRACEPARENT` would attach a trace context
 * nobody asked for, and `HOME` would put the developer's own credentials and
 * fingerprint files in front of the scratch ones.
 *
 * Spec: specs/ai-governance/agent-plugin/plugin-package.feature
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const hookScript = join(pluginRoot, "scripts", "session-context.mjs");

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

const writeCliConfig = (): void => {
  mkdirSync(join(home, ".langwatch"), { recursive: true });
  writeFileSync(
    join(home, ".langwatch", "config.json"),
    JSON.stringify({
      control_plane_url: collectorUrl,
      default_personal_ingest_keys: {
        claude_code: { secret: INGEST_KEY },
      },
    }),
    { mode: 0o600 },
  );
};

/**
 * Run the hook exactly as the plugin's `hooks.json` does, minus the shell: one
 * `node` process, the tool name as its only argument, the payload on stdin.
 */
const runHook = ({
  payload,
  env,
}: {
  payload: unknown;
  env: Record<string, string>;
}): Promise<HookRun> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScript, "claude-code"], {
      cwd: scratch,
      env: { PATH: process.env.PATH ?? "", HOME: home, ...env },
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

/**
 * The collector answers in another process, so a request can still be in flight
 * when the hook has already exited. Give it a moment before concluding nothing
 * was sent, otherwise the silent cases would pass for the wrong reason.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 250));

beforeAll(async () => {
  if (!existsSync(hookScript)) {
    execFileSync("node", [join(pluginRoot, "build.mjs")], {
      cwd: pluginRoot,
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

describe("the bundled session context hook", () => {
  describe("given a signed-in CLI and a session inside a git repository", () => {
    /** @scenario "A session in a git repository reports its context once" */
    it("posts one record and leaves the session's output untouched", async () => {
      writeCliConfig();
      const repository = makeRepository("widgets");

      const run = await runHook({
        payload: {
          session_id: "session-abc",
          cwd: repository,
          hook_event_name: "SessionStart",
        },
        env: { CLAUDECODE: "1" },
      });
      await settle();

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
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
    });
  });

  describe("given a machine that never signed in", () => {
    /** @scenario "A session on a machine that never signed in reports nothing" */
    it("sends nothing and exits zero", async () => {
      const repository = makeRepository("widgets");

      const run = await runHook({
        payload: {
          session_id: "session-abc",
          cwd: repository,
          hook_event_name: "SessionStart",
        },
        env: { CLAUDECODE: "1" },
      });
      await settle();

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
      expect(received).toEqual([]);
    });
  });

  describe("given a session working outside any git repository", () => {
    /** @scenario "A session outside a git repository reports nothing" */
    it("sends nothing and exits zero", async () => {
      writeCliConfig();
      const plain = join(scratch, "not-a-repository");
      mkdirSync(plain, { recursive: true });

      const run = await runHook({
        payload: {
          session_id: "session-abc",
          cwd: plain,
          hook_event_name: "SessionStart",
        },
        env: { CLAUDECODE: "1" },
      });
      await settle();

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
      expect(received).toEqual([]);
    });
  });

  describe("given another Agent Plugins client that discovered the Claude Code hooks", () => {
    /** @scenario "An agent that is not Claude Code is never reported as Claude Code" */
    it("sends nothing and exits zero", async () => {
      writeCliConfig();
      const repository = makeRepository("widgets");

      const run = await runHook({
        payload: {
          session_id: "codex-thread-1",
          cwd: repository,
          hook_event_name: "SessionStart",
        },
        env: {},
      });
      await settle();

      expect(run.exitCode).toBe(0);
      expect(run.stdout).toBe("");
      expect(received).toEqual([]);
    });
  });
});
