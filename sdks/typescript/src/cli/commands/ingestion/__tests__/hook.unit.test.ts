/**
 * What the session context hook reports: the repository, branch and worktree a
 * session is working in, the agent whose seam invoked it, and the trace a Stop
 * invocation carries.
 *
 * Where the record goes is hook-target, when it stays quiet is hook-dedup, and
 * the promises it makes to the session are hook-silence.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { describe, expect, it } from "vitest";

import {
  attributesOf,
  ENDPOINT,
  installHookHarness,
  recordOf,
  SESSION_ID,
  TRACEPARENT,
} from "./hook-harness";

const hook = installHookHarness();
const { posted } = hook;

describe("the session context hook", () => {
  describe("given a session inside a git worktree with an origin remote", () => {
    /** @scenario "The hook posts repo, branch and worktree for the session" */
    it("posts one record carrying the session, repository, branch and worktree", async () => {
      await hook.runHook();

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
      expect(hook.exits).toEqual([]);
    });

    it("sends the configured OTLP headers alongside a json content type", async () => {
      await hook.runHook({
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
      await hook.runHook({
        input: { cwd: "/repo/worktrees/review" },
        env: { CLAUDE_CODE_SESSION_ID: "env-session" },
      });

      expect(attributesOf(posted[0]!)["session.id"]).toBe("env-session");
    });

    it("omits the branch on a detached head and the worktree in the main checkout", async () => {
      await hook.runHook({
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
      await hook.runHook({ tool });

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
      await hook.runHook({
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
      await hook.runHook({
        tool: "codex",
        input: { cwd: "/repo/worktrees/review" },
        env: { CLAUDE_CODE_SESSION_ID: "the-parent-claude-session" },
      });

      expect(posted).toEqual([]);
    });
  });

  describe("given a Stop invocation carrying the session's live trace", () => {
    /** @scenario "The Stop hook attaches the live trace context when present" */
    it("attaches that trace and span id to the record", async () => {
      await hook.runHook({
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
      await hook.runHook({
        input: {
          session_id: SESSION_ID,
          cwd: "/repo/worktrees/review",
          hook_event_name: "SessionStart",
        },
      });

      expect(recordOf(posted[0]!)).not.toHaveProperty("traceId");
    });

    /** @scenario "A traceparent that names no live context leaves the record unlinked" */
    it("posts an unlinked record when the traceparent names no live context", async () => {
      // The all-zero ids OTel SDKs emit for an invalid context. Carrying them
      // would point the record at a trace that was never created.
      await hook.runHook({
        input: {
          session_id: SESSION_ID,
          cwd: "/repo/worktrees/review",
          hook_event_name: "Stop",
        },
        env: {
          TRACEPARENT:
            "00-00000000000000000000000000000000-0000000000000000-01",
        },
      });

      expect(recordOf(posted[0]!)).not.toHaveProperty("traceId");
      expect(recordOf(posted[0]!)).not.toHaveProperty("spanId");
    });
  });
});
