/**
 * `langwatch ingest context`: the agent declares the repository and branch it
 * is working on, itself. Which session it declares for, what it posts, what
 * it says back, and how it shares the fingerprint state with the hooks.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-declare.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AncestorProbe } from "@/cli/utils/governance/codex-ancestor-session";
import {
  readSpooledDeclarations,
  spoolDir,
  spoolFilePath,
} from "@/cli/utils/governance/session-context-spool";

import { contextCommand } from "../context";
import { hookCommand } from "../hook";
import {
  attributesOf,
  ENDPOINT,
  gitRunner,
  type PostedRequest,
  recordOf,
  SESSION_ID,
  TRACEPARENT,
  unreachableCollector,
  WORKTREE_GIT,
} from "./hook-harness";

const NOW = 1_700_000_000_000;
const CODEX_SESSION = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c33";
const OTHER_CODEX_SESSION = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c44";

const CLAUDE_ENV = {
  CLAUDECODE: "1",
  CLAUDE_CODE_SESSION_ID: SESSION_ID,
};

let stateDir: string;
let sessionsRoot: string;
let tmpRoot: string;
let previousTmpdir: string | undefined;
const posted: PostedRequest[] = [];
const lines: string[] = [];

const collector = (status = 200): typeof fetch =>
  ((url: string, init: { headers: Record<string, string>; body: string }) => {
    posted.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body) as PostedRequest["body"],
    });
    return Promise.resolve(new Response("{}", { status }));
  }) as unknown as typeof fetch;

beforeEach(() => {
  posted.length = 0;
  lines.length = 0;
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-context-state-"));
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lw-context-tmp-"));
  previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = tmpRoot;
  sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lw-context-codex-"));
});

afterEach(() => {
  if (previousTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmpdir;
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeRollout({
  sessionId = CODEX_SESSION,
  agoMs = 60_000,
}: { sessionId?: string; agoMs?: number } = {}): void {
  const dir = path.join(sessionsRoot, "2026", "08", "22");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-2026-08-22T10-00-00-${sessionId}.jsonl`);
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ type: "session_meta", payload: { id: sessionId } }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "user_message", message: "review the auth PR" },
      }),
    ].join("\n"),
  );
  const mtime = new Date(NOW - agoMs);
  fs.utimesSync(file, mtime, mtime);
}

/** A process tree where nothing holds a rollout open: the fallback path. */
const NO_ANCESTOR: AncestorProbe = {
  parentPidOf: async () => null,
  openFilesOf: async () => [],
};

/** A process tree whose ancestor 90 holds this session's rollout open. */
const ancestorHolding = (sessionId: string): AncestorProbe => ({
  parentPidOf: async (pid) => (pid === 100 ? 90 : null),
  openFilesOf: async (pid) =>
    pid === 90
      ? [
          path.join(
            sessionsRoot,
            "2026",
            "08",
            "22",
            `rollout-2026-08-22T10-00-00-${sessionId}.jsonl`,
          ),
        ]
      : [],
});

const runContext = (options: Partial<Parameters<typeof contextCommand>[0]> = {}) =>
  contextCommand({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, ...CLAUDE_ENV },
    cwd: "/repo/worktrees/review",
    runGit: gitRunner(WORKTREE_GIT),
    fetchImpl: collector(),
    now: () => NOW,
    stateDir,
    claudeRegistryDir: path.join(stateDir, "claude-sessions"),
    codexSessionsRoot: sessionsRoot,
    ancestorStartPid: 100,
    ancestorProbe: NO_ANCESTOR,
    readCliConfig: () => ({}),
    writeLine: (line) => lines.push(line),
    ...options,
  });

describe("the declare command's session resolution", () => {
  /** @scenario "A claude session is resolved from its own environment" */
  it("declares for the claude session named by the environment", async () => {
    await runContext();

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)).toMatchObject({
      "coding_agent.name": "claude_code",
      "session.id": SESSION_ID,
    });
  });

  /** @scenario "A codex session is resolved from the one active rollout" */
  it("declares for the active codex rollout when there is no claude environment", async () => {
    writeRollout();

    await runContext({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT } });

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)).toMatchObject({
      "coding_agent.name": "codex",
      "session.id": CODEX_SESSION,
      "langwatch.session.title": "review the auth PR",
    });
  });

  /** @scenario "A codex launched inside a claude session declares for the claude session" */
  it("prefers the claude environment over a live codex rollout", async () => {
    writeRollout();

    await runContext();

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)["coding_agent.name"]).toBe("claude_code");
  });

  /** @scenario "Explicit flags override every resolution" */
  it("declares for exactly the agent and session the flags name", async () => {
    await runContext({ agent: "codex", sessionId: "explicit-thread" });

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)).toMatchObject({
      "coding_agent.name": "codex",
      "session.id": "explicit-thread",
    });
  });

  it("asks for both flags when only one is passed", async () => {
    await runContext({ sessionId: "half-a-session" });

    expect(posted).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("--agent");
  });

  /** @scenario "The invoking codex session is resolved from the ancestor process that holds the rollout open" */
  it("declares for the session whose process this runs under", async () => {
    writeRollout({ sessionId: CODEX_SESSION, agoMs: 5 * 60_000 });
    writeRollout({ sessionId: OTHER_CODEX_SESSION, agoMs: 1_000 });

    await runContext({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
      ancestorProbe: ancestorHolding(CODEX_SESSION),
    });

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)).toMatchObject({
      "coding_agent.name": "codex",
      "session.id": CODEX_SESSION,
      "langwatch.session.title": "review the auth PR",
    });
  });

  /** @scenario "The invoking codex session is resolved from the ancestor process that holds the rollout open" */
  it("declares for the ancestor session while a second session is mid-turn", async () => {
    writeRollout({ sessionId: CODEX_SESSION, agoMs: 5_000 });
    writeRollout({ sessionId: OTHER_CODEX_SESSION, agoMs: 2_000 });

    await runContext({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
      ancestorProbe: ancestorHolding(OTHER_CODEX_SESSION),
    });

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)["session.id"]).toBe(OTHER_CODEX_SESSION);
  });

  it("prefers the claude environment over the ancestor codex session", async () => {
    writeRollout({ sessionId: CODEX_SESSION });

    await runContext({ ancestorProbe: ancestorHolding(CODEX_SESSION) });

    expect(attributesOf(posted[0]!)["coding_agent.name"]).toBe("claude_code");
  });

  it("prefers explicit flags over the ancestor codex session", async () => {
    writeRollout({ sessionId: CODEX_SESSION });

    await runContext({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
      ancestorProbe: ancestorHolding(CODEX_SESSION),
      agent: "codex",
      sessionId: "explicit-thread",
    });

    expect(attributesOf(posted[0]!)["session.id"]).toBe("explicit-thread");
  });

  /** @scenario "Two simultaneously active codex sessions declare nothing" */
  it("declares nothing when two codex sessions are mid-turn at once", async () => {
    writeRollout({ sessionId: CODEX_SESSION, agoMs: 5_000 });
    writeRollout({ sessionId: OTHER_CODEX_SESSION, agoMs: 20_000 });

    await runContext({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
      fetchImpl: unreachableCollector,
    });

    expect(posted).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("--session-id");
  });

  /** @scenario "The session in the middle of a turn wins over an idle one" */
  it("declares for the mid-turn session, not the idle one", async () => {
    writeRollout({ sessionId: OTHER_CODEX_SESSION, agoMs: 6 * 60_000 });
    writeRollout({ sessionId: CODEX_SESSION, agoMs: 5_000 });

    await runContext({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT } });

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)["session.id"]).toBe(CODEX_SESSION);
  });

  /** @scenario "A codex restart still resolves without flags" */
  it("declares for the running session when a restart left a recent dead rollout", async () => {
    writeRollout({ sessionId: OTHER_CODEX_SESSION, agoMs: 3 * 60_000 });
    writeRollout({ sessionId: CODEX_SESSION, agoMs: 2_000 });

    await runContext({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT } });

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)["session.id"]).toBe(CODEX_SESSION);
  });

  /** @scenario "Explicit flags name a session while two are active" */
  it("declares for the named session even while two are mid-turn", async () => {
    writeRollout({ sessionId: CODEX_SESSION, agoMs: 5_000 });
    writeRollout({ sessionId: OTHER_CODEX_SESSION, agoMs: 20_000 });

    await runContext({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
      agent: "codex",
      sessionId: OTHER_CODEX_SESSION,
    });

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)["session.id"]).toBe(OTHER_CODEX_SESSION);
  });

  it("rejects a session id that is only whitespace", async () => {
    await runContext({
      agent: "codex",
      sessionId: "   ",
      fetchImpl: unreachableCollector,
    });

    expect(posted).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("--agent");
  });

  /** @scenario "A stale rollout does not resolve" */
  it("says no live session was found and how to name one", async () => {
    writeRollout({ agoMs: 16 * 60_000 });

    await runContext({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT } });

    expect(posted).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("--session-id");
  });
});

describe("what the declaration posts", () => {
  /** @scenario "Declaring inside a checkout posts repo, branch and worktree" */
  it("posts the repository, branch and worktree and says what it declared", async () => {
    await runContext();

    expect(attributesOf(posted[0]!)).toMatchObject({
      "vcs.repository.host": "github.com",
      "vcs.repository.owner": "langwatch",
      "vcs.repository.name": "langwatch",
      "vcs.ref.head.name": "feat/session-context",
      "vcs.worktree.name": "review",
    });
    expect(lines).toEqual([
      `Declared github.com/langwatch/langwatch@feat/session-context for claude_code session ${SESSION_ID}`,
    ]);
  });

  /** @scenario "A detached HEAD declares the repository without a branch" */
  it("posts the repository and no branch on a detached HEAD", async () => {
    const detached = { ...WORKTREE_GIT };
    delete detached["branch --show-current"];

    await runContext({ runGit: gitRunner(detached) });

    const attributes = attributesOf(posted[0]!);
    expect(attributes["vcs.repository.name"]).toBe("langwatch");
    expect(attributes["vcs.ref.head.name"]).toBeUndefined();
  });

  /** @scenario "A live traceparent rides the record" */
  it("attaches the trace context from the environment", async () => {
    await runContext({
      env: {
        OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
        TRACEPARENT,
        ...CLAUDE_ENV,
      },
    });

    expect(recordOf(posted[0]!).traceId).toBe("16872e6253edb3e8748023ff172703c4");
    expect(recordOf(posted[0]!).spanId).toBe("be7ce7c6bf1173f5");
  });
});

describe("the declare command's refusals", () => {
  /** @scenario "Outside a git repository nothing is posted" */
  it("says there is no repository and posts nothing", async () => {
    await runContext({ runGit: gitRunner({}) });

    expect(posted).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("No git repository");
  });

  /** @scenario "Without telemetry configuration nothing is posted" */
  it("says telemetry is not configured and posts nothing", async () => {
    await runContext({ env: { ...CLAUDE_ENV } });

    expect(posted).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("not configured");
  });

  /** @scenario "A failed post does not record the fingerprint" */
  /** @scenario "A declaration that cannot be delivered is queued, not lost" */
  it("queues the declaration and records no fingerprint", async () => {
    await runContext({ fetchImpl: unreachableCollector });

    // Nothing claims the context landed: only the spool directory exists.
    expect(fs.readdirSync(stateDir)).toEqual(["spool"]);
    const queued = readSpooledDeclarations({ stateDir, now: () => NOW });
    expect(queued).toHaveLength(1);
    expect(queued[0]!.agent).toBe("claude_code");
    expect(queued[0]!.sessionId).toBe(SESSION_ID);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Queued");
    expect(lines[0]).toContain("next reports");
  });

  /** @scenario "A successful declaration queues nothing" */
  it("queues nothing when the collector accepts the declaration", async () => {
    await runContext();

    expect(posted).toHaveLength(1);
    expect(fs.existsSync(spoolDir(stateDir))).toBe(false);
  });

  /** @scenario "A declaration that cannot be delivered is queued, not lost" */
  it("keeps only the newest queued declaration for a session", async () => {
    await runContext({ fetchImpl: unreachableCollector });
    await runContext({
      fetchImpl: unreachableCollector,
      runGit: gitRunner({
        ...WORKTREE_GIT,
        "branch --show-current": "feat/another-branch",
      }),
    });

    expect(readSpooledDeclarations({ stateDir, now: () => NOW })).toHaveLength(1);
  });
});

describe("the declaration and the hooks share one fingerprint", () => {
  /** @scenario "A declaration and a hook for the same context post once between them" */
  it("declares nothing after the hook already posted the same context", async () => {
    const hookPosted: unknown[] = [];
    await hookCommand({
      tool: "claude-code",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
      readInput: () =>
        Promise.resolve(
          JSON.stringify({
            session_id: SESSION_ID,
            cwd: "/repo/worktrees/review",
          }),
        ),
      runGit: gitRunner(WORKTREE_GIT),
      fetchImpl: ((_url: string, init: { body: string }) => {
        hookPosted.push(JSON.parse(init.body));
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as unknown as typeof fetch,
      now: () => NOW,
      stateDir,
      claudeRegistryDir: path.join(stateDir, "claude-sessions"),
      readCliConfig: () => ({}),
    });
    expect(hookPosted).toHaveLength(1);

    await runContext();

    expect(posted).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("already declared");
  });

  it("re-declares when the branch changed since the hook posted", async () => {
    await runContext();
    expect(posted).toHaveLength(1);

    await runContext({
      runGit: gitRunner({
        ...WORKTREE_GIT,
        "branch --show-current": "fix/regression",
      }),
    });

    expect(posted).toHaveLength(2);
    expect(attributesOf(posted[1]!)["vcs.ref.head.name"]).toBe("fix/regression");
  });
});

describe("a queued declaration and the next session report", () => {
  /** Drive the real claude hook seam, collecting every body it sends. */
  const runHookSeam = ({
    fetchImpl,
    cwd = "/repo",
  }: { fetchImpl?: typeof fetch; cwd?: string } = {}) =>
    hookCommand({
      tool: "claude-code",
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
      readInput: () => Promise.resolve(JSON.stringify({ session_id: SESSION_ID, cwd })),
      runGit: gitRunner({
        ...WORKTREE_GIT,
        "branch --show-current": "main",
        "rev-parse --show-toplevel": "/repo",
      }),
      fetchImpl: fetchImpl ?? collector(),
      now: () => NOW,
      stateDir,
      claudeRegistryDir: path.join(stateDir, "claude-sessions"),
      readCliConfig: () => ({}),
    });

  /** @scenario "The next session report sends the queued declaration" */
  it("sends the queued declaration and leaves the spool empty", async () => {
    await runContext({ fetchImpl: unreachableCollector });
    expect(posted).toHaveLength(0);

    await runHookSeam();

    const branches = posted.map((request) => attributesOf(request)["vcs.ref.head.name"]);
    expect(branches).toContain("feat/session-context");
    expect(readSpooledDeclarations({ stateDir, now: () => NOW })).toEqual([]);
  });

  /** @scenario "The queued declaration is the session's latest branch" */
  it("posts the declared context last, after the hook's own directory", async () => {
    await runContext({ fetchImpl: unreachableCollector });

    await runHookSeam();

    // The hook reports /repo on main; the declaration reports the worktree.
    // The declaration has to land last or the session keeps the hook branch.
    expect(posted.length).toBeGreaterThanOrEqual(2);
    expect(attributesOf(posted[0]!)["vcs.ref.head.name"]).toBe("main");
    expect(attributesOf(posted[posted.length - 1]!)["vcs.ref.head.name"]).toBe(
      "feat/session-context",
    );
  });

  /** @scenario "The next session report sends the queued declaration" */
  it("records the declared fingerprint, so the next turn stays quiet", async () => {
    await runContext({ fetchImpl: unreachableCollector });
    await runHookSeam();
    posted.length = 0;
    lines.length = 0;

    await runContext();

    expect(posted).toHaveLength(0);
    expect(lines[0]).toContain("already declared");
  });

  /** @scenario "An expired queued declaration is dropped without posting" */
  it("drops a declaration queued more than an hour ago", async () => {
    await runContext({ fetchImpl: unreachableCollector });
    const entry = spoolFilePath({
      stateDir,
      agent: "claude_code",
      sessionId: SESSION_ID,
    });
    const stale = JSON.parse(fs.readFileSync(entry, "utf8")) as Record<string, unknown>;
    stale.queued_at_ms = NOW - 61 * 60_000;
    fs.writeFileSync(entry, JSON.stringify(stale));

    await runHookSeam();

    const branches = posted.map((request) => attributesOf(request)["vcs.ref.head.name"]);
    expect(branches).not.toContain("feat/session-context");
    expect(fs.existsSync(entry)).toBe(false);
  });

  /** @scenario "A queued declaration survives a failed send" */
  it("keeps the entry when the send fails again", async () => {
    await runContext({ fetchImpl: unreachableCollector });

    await runHookSeam({ fetchImpl: unreachableCollector });

    expect(readSpooledDeclarations({ stateDir, now: () => NOW })).toHaveLength(1);
  });
});
