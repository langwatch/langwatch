/**
 * `langwatch ingest hook pi`, fed the payload pi's telemetry extension hands
 * it: the extension never writes the record, the command does.
 * Feature: specs/ai-governance/cli-wrappers/pi-extension-install.feature
 */

import { describe, expect, it } from "vitest";

import { attributesOf, installHookHarness, SESSION_ID, WORKTREE_GIT } from "./hook-harness";

const hook = installHookHarness();
const { posted } = hook;

/** The payload the extension writes to the command's stdin at agent start. */
const extensionPayload = (cwd: string) => ({
  session_id: SESSION_ID,
  cwd,
  hook_event_name: "SessionStart",
});

describe("the session context hook for pi", () => {
  describe("when pi starts a run in a git repository on a branch", () => {
    /** @scenario "The extension runs the hook command at agent start" */
    it("posts a session context record carrying pi's session, repository and head branch", async () => {
      await hook.runHook({ tool: "pi", input: extensionPayload("/repo/worktrees/review") });

      expect(posted).toHaveLength(1);
      expect(attributesOf(posted[0]!)).toMatchObject({
        "session.id": SESSION_ID,
        "coding_agent.name": "pi",
        "vcs.repository.owner": "langwatch",
        "vcs.repository.name": "langwatch",
        "vcs.ref.head.name": WORKTREE_GIT["branch --show-current"],
      });
      expect(hook.exits).toEqual([]);
    });
  });

  describe("when pi starts a run outside any git repository", () => {
    /** @scenario "A pi run outside a git repository posts no context rather than an empty one" */
    it("posts nothing and exits cleanly", async () => {
      await hook.runHook({
        tool: "pi",
        input: extensionPayload("/tmp/not-a-repo"),
        runGit: () => null,
      });

      expect(posted).toEqual([]);
      expect(hook.exits).toEqual([]);
    });
  });
});
