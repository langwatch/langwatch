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

const CLAUDE_ENV = {
  CLAUDECODE: "1",
  CLAUDE_CODE_SESSION_ID: SESSION_ID,
};

let stateDir: string;
let sessionsRoot: string;
const posted: PostedRequest[] = [];
const lines: string[] = [];

const collector =
  (status = 200): typeof fetch =>
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
  sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lw-context-codex-"));
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
});

function writeRollout({
  sessionId = CODEX_SESSION,
  agoMs = 60_000,
}: { sessionId?: string; agoMs?: number } = {}): void {
  const dir = path.join(sessionsRoot, "2026", "08", "22");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `rollout-2026-08-22T10-00-00-${sessionId}.jsonl`,
  );
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

const runContext = (
  options: Partial<Parameters<typeof contextCommand>[0]> = {},
) =>
  contextCommand({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, ...CLAUDE_ENV },
    cwd: "/repo/worktrees/review",
    runGit: gitRunner(WORKTREE_GIT),
    fetchImpl: collector(),
    now: () => NOW,
    stateDir,
    claudeRegistryDir: path.join(stateDir, "claude-sessions"),
    codexSessionsRoot: sessionsRoot,
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

  /** @scenario "A codex session is resolved from the newest recently-active rollout" */
  it("declares for the newest active codex rollout when there is no claude environment", async () => {
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

    expect(recordOf(posted[0]!).traceId).toBe(
      "16872e6253edb3e8748023ff172703c4",
    );
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
  it("keeps no fingerprint when the collector cannot be reached", async () => {
    await runContext({ fetchImpl: unreachableCollector });

    expect(fs.readdirSync(stateDir)).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("retried");
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
    expect(attributesOf(posted[1]!)["vcs.ref.head.name"]).toBe(
      "fix/regression",
    );
  });
});
