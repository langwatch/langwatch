/**
 * The session context hook end to end, with git, the collector and the clock
 * faked: what it posts, when it stays quiet, and the two promises it makes to
 * every session it runs in: nothing on stdout, and never a non-zero exit.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hookCommand, type GitRunner } from "../hook";

const ENDPOINT = "http://app.example.com/api/otel";
const SESSION_ID = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c11";
const TRACEPARENT = "00-16872e6253edb3e8748023ff172703c4-be7ce7c6bf1173f5-01";

/** A linked worktree of langwatch/langwatch, checked out on a feature branch. */
const WORKTREE_GIT: Record<string, string> = {
  "remote get-url origin": "git@github.com:langwatch/langwatch.git",
  "branch --show-current": "feat/session-context",
  "rev-parse --git-dir": "/repo/.git/worktrees/review",
  "rev-parse --git-common-dir": "/repo/.git",
  "rev-parse --show-toplevel": "/repo/worktrees/review",
};

const gitRunner =
  (responses: Record<string, string>): GitRunner =>
  ({ args }) =>
    responses[args.join(" ")] ?? null;

interface PostedRequest {
  url: string;
  headers: Record<string, string>;
  body: OtlpBody;
}

interface OtlpAttribute {
  key: string;
  value: { stringValue: string };
}

interface OtlpBody {
  resourceLogs: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeLogs: Array<{
      scope: { name: string; version: string };
      logRecords: Array<{
        eventName: string;
        timeUnixNano: string;
        attributes: OtlpAttribute[];
        traceId?: string;
        spanId?: string;
      }>;
    }>;
  }>;
}

let posted: PostedRequest[];
let stateDir: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

/** Records every request and answers with whatever `status` says. */
const collector = (status = 200): typeof fetch =>
  ((url: string, init: { headers: Record<string, string>; body: string }) => {
    posted.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body) as OtlpBody,
    });
    return Promise.resolve(new Response("{}", { status }));
  }) as unknown as typeof fetch;

/** A collector that is not there at all. */
const unreachableCollector: typeof fetch = (async () => {
  throw new Error("connect ECONNREFUSED");
}) as unknown as typeof fetch;

/** A CLI that was never signed in, so the config fallback names no collector. */
const NO_CLI_CONFIG = () => ({});

const runHook = async ({
  input = { session_id: SESSION_ID, cwd: "/repo/worktrees/review" },
  env = {},
  git = WORKTREE_GIT,
  fetchImpl = collector(),
  now = 1_700_000_000_000,
  tool = "claude-code",
  readCliConfig = NO_CLI_CONFIG,
}: {
  input?: Record<string, unknown> | string;
  env?: NodeJS.ProcessEnv;
  git?: Record<string, string>;
  fetchImpl?: typeof fetch;
  now?: number;
  tool?: string;
  readCliConfig?: Parameters<typeof hookCommand>[0]["readCliConfig"];
} = {}): Promise<void> => {
  await hookCommand({
    tool,
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, ...env },
    readInput: () =>
      Promise.resolve(typeof input === "string" ? input : JSON.stringify(input)),
    runGit: gitRunner(git),
    fetchImpl,
    now: () => now,
    stateDir,
    readCliConfig,
  });
};

const attributesOf = (request: PostedRequest): Record<string, string> =>
  Object.fromEntries(
    request.body.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.attributes.map(
      (attribute) => [attribute.key, attribute.value.stringValue],
    ),
  );

const recordOf = (request: PostedRequest) =>
  request.body.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;

beforeEach(() => {
  posted = [];
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-hook-state-"));
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation((() => undefined) as never);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  exitSpy.mockRestore();
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("the claude-code session context hook", () => {
  describe("given a session inside a git worktree with an origin remote", () => {
    /** @scenario "The hook posts repo, branch and worktree for the session" */
    it("posts one record carrying the session, repository, branch and worktree", async () => {
      await runHook();

      expect(posted).toHaveLength(1);
      expect(posted[0]!.url).toBe(`${ENDPOINT}/v1/logs`);
      expect(recordOf(posted[0]!).eventName).toBe("langwatch.session_context");
      expect(attributesOf(posted[0]!)).toMatchObject({
        "session.id": SESSION_ID,
        "coding_agent.name": "claude_code",
        "vcs.repository.host": "github.com",
        "vcs.repository.owner": "langwatch",
        "vcs.repository.name": "langwatch",
        "vcs.ref.head.name": "feat/session-context",
        "vcs.worktree.name": "review",
      });
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("sends the configured OTLP headers alongside a json content type", async () => {
      await runHook({
        env: {
          OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer ik-lw-abc_secret",
        },
      });

      expect(posted[0]!.headers).toEqual({
        Authorization: "Bearer ik-lw-abc_secret",
        "content-type": "application/json",
      });
    });

    it("takes the session id from the environment when the payload omits it", async () => {
      await runHook({
        input: { cwd: "/repo/worktrees/review" },
        env: { CLAUDE_CODE_SESSION_ID: "env-session" },
      });

      expect(attributesOf(posted[0]!)["session.id"]).toBe("env-session");
    });

    it("omits the branch on a detached head and the worktree in the main checkout", async () => {
      await runHook({
        git: {
          "remote get-url origin": "https://github.com/langwatch/langwatch.git",
          "rev-parse --git-dir": "/repo/.git",
          "rev-parse --git-common-dir": "/repo/.git",
        },
      });

      const attributes = attributesOf(posted[0]!);
      expect(attributes).not.toHaveProperty("vcs.ref.head.name");
      expect(attributes).not.toHaveProperty("vcs.worktree.name");
    });
  });

  describe("given a seam other than Claude Code's", () => {
    /** @scenario "The record declares the agent whose seam invoked it" */
    it.each([
      ["codex", "codex"],
      ["opencode", "opencode"],
    ])("declares %s when invoked for it", async (tool, agent) => {
      await runHook({ tool });

      expect(posted).toHaveLength(1);
      expect(attributesOf(posted[0]!)).toMatchObject({
        "session.id": SESSION_ID,
        "coding_agent.name": agent,
        "vcs.repository.name": "langwatch",
        "vcs.ref.head.name": "feat/session-context",
      });
    });

    it("ignores Claude Code's variables when nested inside a Claude Code session", async () => {
      // A codex session started from a claude session inherits both, and
      // reading either would report the wrong session on the wrong checkout.
      await runHook({
        tool: "codex",
        input: { session_id: SESSION_ID, cwd: "/repo/worktrees/review" },
        env: {
          CLAUDE_PROJECT_DIR: "/somewhere/else",
          CLAUDE_CODE_SESSION_ID: "the-parent-claude-session",
        },
        git: {
          "remote get-url origin": "git@github.com:langwatch/langwatch.git",
          "rev-parse --git-dir": "/repo/.git",
          "rev-parse --git-common-dir": "/repo/.git",
        },
      });

      expect(posted).toHaveLength(1);
      expect(attributesOf(posted[0]!)["session.id"]).toBe(SESSION_ID);
    });

    it("takes no session id from Claude Code's variable when the payload omits it", async () => {
      await runHook({
        tool: "codex",
        input: { cwd: "/repo/worktrees/review" },
        env: { CLAUDE_CODE_SESSION_ID: "the-parent-claude-session" },
      });

      expect(posted).toEqual([]);
    });

    /** @scenario "Two agents reporting the same session id keep separate fingerprints" */
    it("keeps a fingerprint per agent, so a shared session id does not silence one", async () => {
      await runHook({ tool: "codex" });
      expect(posted).toHaveLength(1);

      await runHook({ tool: "opencode" });

      expect(posted).toHaveLength(2);
      expect(attributesOf(posted[1]!)["coding_agent.name"]).toBe("opencode");
    });

    it("resolves its own agent's ingest key from the CLI config", async () => {
      await hookCommand({
        tool: "codex",
        env: {},
        readInput: () =>
          Promise.resolve(
            JSON.stringify({
              session_id: SESSION_ID,
              cwd: "/repo/worktrees/review",
            }),
          ),
        runGit: gitRunner(WORKTREE_GIT),
        fetchImpl: collector(),
        now: () => 1_700_000_000_000,
        stateDir,
        readCliConfig: () => ({
          control_plane_url: "http://app.example.com",
          default_personal_ingest_keys: {
            claude_code: { secret: "ik-lw-claude" },
            codex: { secret: "ik-lw-codex" },
          },
        }),
      });

      expect(posted[0]!.headers.Authorization).toBe("Bearer ik-lw-codex");
    });
  });

  describe("given a Stop invocation carrying the session's live trace", () => {
    /** @scenario "The Stop hook attaches the live trace context when present" */
    it("attaches that trace and span id to the record", async () => {
      await runHook({
        input: {
          session_id: SESSION_ID,
          cwd: "/repo/worktrees/review",
          hook_event_name: "Stop",
        },
        env: { TRACEPARENT },
      });

      expect(recordOf(posted[0]!).traceId).toBe(
        "16872e6253edb3e8748023ff172703c4",
      );
      expect(recordOf(posted[0]!).spanId).toBe("be7ce7c6bf1173f5");
    });

    it("posts an unlinked record when no traceparent is in the environment", async () => {
      await runHook({
        input: {
          session_id: SESSION_ID,
          cwd: "/repo/worktrees/review",
          hook_event_name: "SessionStart",
        },
      });

      expect(recordOf(posted[0]!)).not.toHaveProperty("traceId");
    });
  });

  describe("given a session whose context was already reported", () => {
    /** @scenario "An unchanged context does not re-post" */
    it("posts nothing the second time the same context is seen", async () => {
      await runHook();
      expect(posted).toHaveLength(1);

      await runHook({
        input: {
          session_id: SESSION_ID,
          cwd: "/repo/worktrees/review",
          hook_event_name: "Stop",
        },
      });

      expect(posted).toHaveLength(1);
    });

    /** @scenario "A changed branch re-posts" */
    it("posts again with the new branch when the session switches branch", async () => {
      await runHook();

      await runHook({
        git: { ...WORKTREE_GIT, "branch --show-current": "fix/regression" },
      });

      expect(posted).toHaveLength(2);
      expect(attributesOf(posted[1]!)["vcs.ref.head.name"]).toBe(
        "fix/regression",
      );
    });

    it("re-posts for a different session in the same repository", async () => {
      await runHook();

      await runHook({
        input: { session_id: "another-session", cwd: "/repo/worktrees/review" },
      });

      expect(posted).toHaveLength(2);
    });
  });

  describe("given a directory that is not a git repository", () => {
    /** @scenario "Outside a git repository the hook sends nothing and exits zero" */
    it("posts nothing, records nothing and exits zero", async () => {
      await runHook({ git: {} });

      expect(posted).toEqual([]);
      expect(fs.readdirSync(stateDir)).toEqual([]);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("posts nothing when the origin remote names no repository", async () => {
      await runHook({ git: { "remote get-url origin": "/srv/git/bare.git" } });

      expect(posted).toEqual([]);
    });
  });

  describe("given no OTLP endpoint in the environment", () => {
    /** @scenario "Without telemetry configuration the hook sends nothing and exits zero" */
    it("posts nothing and exits zero", async () => {
      await hookCommand({
        tool: "claude-code",
        env: {},
        readInput: () =>
          Promise.resolve(JSON.stringify({ session_id: SESSION_ID })),
        runGit: gitRunner(WORKTREE_GIT),
        fetchImpl: collector(),
        now: () => 1_700_000_000_000,
        stateDir,
        readCliConfig: NO_CLI_CONFIG,
      });

      expect(posted).toEqual([]);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    /** @scenario "An agent that strips the exporter variables still reports" */
    it("falls back to the control plane and ingest key the CLI is signed in with", async () => {
      await hookCommand({
        tool: "claude-code",
        env: { CLAUDE_PROJECT_DIR: "/repo/worktrees/review" },
        readInput: () =>
          Promise.resolve(JSON.stringify({ session_id: SESSION_ID })),
        runGit: gitRunner(WORKTREE_GIT),
        fetchImpl: collector(),
        now: () => 1_700_000_000_000,
        stateDir,
        readCliConfig: () => ({
          control_plane_url: "http://app.example.com/",
          default_personal_ingest_keys: {
            claude_code: { secret: "ik-lw-abc_def" },
          },
        }),
      });

      expect(posted).toHaveLength(1);
      expect(posted[0]!.url).toBe("http://app.example.com/api/otel/v1/logs");
      expect(posted[0]!.headers.Authorization).toBe("Bearer ik-lw-abc_def");
      expect(attributesOf(posted[0]!)["vcs.repository.name"]).toBe("langwatch");
    });

    /** @scenario "A signed-in CLI with no key for this agent sends nothing" */
    it("posts nothing when the config carries no ingest key for the agent", async () => {
      await hookCommand({
        tool: "claude-code",
        env: {},
        readInput: () =>
          Promise.resolve(JSON.stringify({ session_id: SESSION_ID })),
        runGit: gitRunner(WORKTREE_GIT),
        fetchImpl: collector(),
        now: () => 1_700_000_000_000,
        stateDir,
        readCliConfig: () => ({
          control_plane_url: "http://app.example.com",
          default_personal_ingest_keys: { codex: { secret: "ik-lw-other" } },
        }),
      });

      expect(posted).toEqual([]);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("prefers the logs-specific endpoint variable when it is set", async () => {
      await runHook({
        env: {
          OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://collector.example.com/logs",
        },
      });

      expect(posted[0]!.url).toBe("http://collector.example.com/logs");
    });

    it("prefers the environment over the CLI config when both name a collector", async () => {
      await runHook({
        readCliConfig: () => ({
          control_plane_url: "http://fallback.example.com",
          default_personal_ingest_keys: {
            claude_code: { secret: "ik-lw-fallback" },
          },
        }),
      });

      expect(posted[0]!.url).toBe(`${ENDPOINT}/v1/logs`);
    });
  });

  describe("given a telemetry endpoint that cannot be reached", () => {
    /** @scenario "The hook never writes to stdout even when the post fails" */
    it("writes nothing to stdout and exits zero", async () => {
      await runHook({ fetchImpl: unreachableCollector });

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("keeps no fingerprint, so the next hook in the session retries", async () => {
      await runHook({ fetchImpl: unreachableCollector });
      expect(fs.readdirSync(stateDir)).toEqual([]);

      await runHook();

      expect(posted).toHaveLength(1);
    });

    it("treats a collector that rejects the record as a failure", async () => {
      await runHook({ fetchImpl: collector(500) });

      expect(fs.readdirSync(stateDir)).toEqual([]);
    });
  });

  describe("given input or a tool the hook cannot act on", () => {
    it.each([
      ["empty stdin", ""],
      ["stdin that is not json", "not json at all"],
      ["a json array", "[]"],
    ])("stays silent on %s", async (_label, input) => {
      await runHook({ input });

      expect(posted).toEqual([]);
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("stays silent for a tool it has no hook for", async () => {
      await runHook({ tool: "gemini" });

      expect(posted).toEqual([]);
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    /** @scenario "A seam that fires with no session id sends nothing and exits zero" */
    it("stays silent when the payload carries no session id", async () => {
      await runHook({ input: { cwd: "/repo/worktrees/review" } });

      expect(posted).toEqual([]);
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("given fingerprints left behind by long-finished sessions", () => {
    it("prunes the ones older than a week and keeps the rest", async () => {
      const stale = path.join(stateDir, "stale.json");
      const recent = path.join(stateDir, "recent.json");
      fs.writeFileSync(stale, JSON.stringify({ fingerprint: "old" }));
      fs.writeFileSync(recent, JSON.stringify({ fingerprint: "new" }));
      const now = 1_700_000_000_000;
      const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1_000);
      fs.utimesSync(stale, eightDaysAgo, eightDaysAgo);

      await runHook({ now });

      expect(fs.existsSync(stale)).toBe(false);
      expect(fs.existsSync(recent)).toBe(true);
    });
  });
});
