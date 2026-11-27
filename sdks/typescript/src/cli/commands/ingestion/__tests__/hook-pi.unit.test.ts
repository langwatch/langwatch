/**
 * `langwatch ingest hook pi`, fed the extension's payload: the command writes the record.
 * Features: specs/ai-governance/cli-wrappers/pi-extension-install.feature,
 * specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { sessionContextAgentFor } from "@/cli/utils/governance/session-context-agents";

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

  describe("when the user named the session in pi", () => {
    /** @scenario "The name the user gave a pi session rides the context record" */
    it("carries pi's session name on the record", async () => {
      await hook.runHook({
        tool: "pi",
        input: { ...extensionPayload("/repo/worktrees/review"), session_title: "widget fix" },
      });

      expect(attributesOf(posted[0]!)).toMatchObject({
        "coding_agent.name": "pi",
        "langwatch.session.name": "widget fix",
      });
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

describe("pi's row in the session context agent table", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** @scenario "pi's row carries a plugin hook target, as opencode's does" */
  it("is a plugin in pi's extension directory, keyed by pi_cli, with no session id variable", () => {
    vi.stubEnv("PI_CODING_AGENT_DIR", "");
    const row = sessionContextAgentFor("pi");

    expect(row).toMatchObject({ agent: "pi", keySourceTypes: ["pi_cli"] });
    expect(row).not.toHaveProperty("sessionIdVar");
    expect(row?.hookTarget.kind).toBe("plugin");
    expect(row?.hookTarget.resolve().displayPath).toBe(
      "~/.pi/agent/extensions/langwatch-pi-telemetry.ts",
    );
  });
});

describe("the session-context command for a record the pi extension asked for", () => {
  /** @scenario "The session-context command accepts a record the pi extension asked for" */
  it("declares pi, carries the extension's session id and posts with pi_cli's key", async () => {
    await hook.runHook({
      tool: "pi",
      input: { ...extensionPayload("/repo/worktrees/review"), session_id: "s-1" },
      shouldOmitExporterEnv: true,
      readCliConfig: () => ({
        control_plane_url: "https://app.example.com",
        default_personal_ingest_keys: { pi_cli: { secret: "ik-lw-pi" } },
      }),
    });

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)).toMatchObject({
      "session.id": "s-1",
      "coding_agent.name": "pi",
    });
    expect(posted[0]!.headers.Authorization).toBe("Bearer ik-lw-pi");
    expect(hook.exits).toEqual([]);
  });
});
