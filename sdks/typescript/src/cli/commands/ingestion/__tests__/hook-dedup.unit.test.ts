/**
 * What the session context hook remembers between invocations: one fingerprint
 * per session, so a quiet session stays quiet and a branch switch re-posts.
 *
 * A post that does not land deliberately records nothing, so the next hook in
 * the same session retries rather than assuming the context arrived.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  attributesOf,
  installHookHarness,
  NOW,
  SESSION_ID,
  unreachableCollector,
  WORKTREE_GIT,
} from "./hook-harness";

const hook = installHookHarness();
const { posted } = hook;

describe("the session context hook's per-session fingerprint", () => {
  describe("given a session whose context was already reported", () => {
    /** @scenario "An unchanged context does not re-post" */
    it("posts nothing the second time the same context is seen", async () => {
      await hook.runHook();
      expect(posted).toHaveLength(1);

      await hook.runHook({
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
      await hook.runHook();

      await hook.runHook({
        git: { ...WORKTREE_GIT, "branch --show-current": "fix/regression" },
      });

      expect(posted).toHaveLength(2);
      expect(attributesOf(posted[1]!)["vcs.ref.head.name"]).toBe(
        "fix/regression",
      );
    });

    it("re-posts for a different session in the same repository", async () => {
      await hook.runHook();

      await hook.runHook({
        input: { session_id: "another-session", cwd: "/repo/worktrees/review" },
      });

      expect(posted).toHaveLength(2);
    });

    /** @scenario "Two agents reporting the same session id keep separate fingerprints" */
    it("keeps a fingerprint per agent, so a shared session id does not silence one", async () => {
      await hook.runHook({ tool: "codex" });
      expect(posted).toHaveLength(1);

      await hook.runHook({ tool: "opencode" });

      expect(posted).toHaveLength(2);
      expect(attributesOf(posted[1]!)["coding_agent.name"]).toBe("opencode");
    });
  });

  describe("given a session that was renamed between runs", () => {
    /** @scenario "A renamed session re-posts its context" */
    it("posts again carrying the new name", async () => {
      const named = (title: string) => ({
        session_id: SESSION_ID,
        cwd: "/repo/worktrees/review",
        session_title: title,
      });
      await hook.runHook({ input: named("pr-reviewer") });
      await hook.runHook({ input: named("pr-hound") });

      expect(posted).toHaveLength(2);
      expect(attributesOf(posted[1]!)).toMatchObject({
        "langwatch.session.name": "pr-hound",
      });
    });
  });

  describe("given a post that does not land", () => {
    it("records nothing when the collector cannot be reached", async () => {
      await hook.runHook({ fetchImpl: unreachableCollector });

      expect(fs.readdirSync(hook.stateDir)).toEqual([]);
    });

    it("records nothing when the collector rejects the record", async () => {
      await hook.runHook({ fetchImpl: hook.collector(500) });

      expect(fs.readdirSync(hook.stateDir)).toEqual([]);
    });

    it("retries on the next hook in the same session", async () => {
      await hook.runHook({ fetchImpl: unreachableCollector });

      await hook.runHook();

      expect(posted).toHaveLength(1);
    });
  });

  describe("given fingerprints left behind by long-finished sessions", () => {
    it("prunes the ones older than a week and keeps the rest", async () => {
      const stale = path.join(hook.stateDir, "stale.json");
      const recent = path.join(hook.stateDir, "recent.json");
      fs.writeFileSync(stale, JSON.stringify({ fingerprint: "old" }));
      fs.writeFileSync(recent, JSON.stringify({ fingerprint: "new" }));
      const eightDaysAgo = new Date(NOW - 8 * 24 * 60 * 60 * 1_000);
      fs.utimesSync(stale, eightDaysAgo, eightDaysAgo);

      await hook.runHook();

      expect(fs.existsSync(stale)).toBe(false);
      expect(fs.existsSync(recent)).toBe(true);
    });
  });
});
