/**
 * The session context hook run by Grok, from the payloads grok 1.0.70 really
 * sends (ids and paths scrubbed), and the Claude Code hook Grok also runs.
 * Feature: specs/ai-governance/cli-wrappers/grok-hook-install.feature
 */

import { describe, expect, it } from "vitest";

import { sessionContextAgentFor } from "@/cli/utils/governance/session-context-agents";

import { parseHookInput } from "../hook-input";
import captured from "./fixtures/grok-hook-payloads.json";
import { attributesOf, installHookHarness } from "./hook-harness";

const hook = installHookHarness();
const { posted } = hook;

const grok = captured.grok;

/** What Grok sets on every hook it runs, the Claude Code hooks it borrows included. */
const GROK_ENV = {
  GROK_HOOK_EVENT: "session_start",
  GROK_SESSION_ID: grok.sessionStart.session_id,
  GROK_WORKSPACE_ROOT: grok.sessionStart.cwd,
};

describe("the session context hook run by Grok", () => {
  describe("given Grok's SessionStart payload", () => {
    /** @scenario A Grok hook payload yields its session id and directory */
    it("yields the session id, the directory and the event name", () => {
      expect(parseHookInput(JSON.stringify(grok.sessionStart))).toEqual({
        sessionId: grok.sessionStart.session_id,
        cwd: grok.sessionStart.cwd,
        hookEventName: "SessionStart",
      });
    });

    /** @scenario The Grok hook posts a context record for the grok agent */
    it("posts one record declaring grok and Grok's own session id", async () => {
      await hook.runHook({ tool: "grok", input: grok.sessionStart, env: GROK_ENV });

      expect(posted).toHaveLength(1);
      expect(attributesOf(posted[0]!)).toMatchObject({
        "coding_agent.name": "grok",
        // The same value Grok stamps as session.id on its telemetry.
        "session.id": grok.sessionStart.session_id,
        "vcs.repository.name": "langwatch",
      });
      expect(attributesOf(posted[0]!)).not.toHaveProperty("parent_session_id");
    });

    it("posts with the personal ingest key cached for grok_cli", async () => {
      await hook.runHook({
        tool: "grok",
        input: grok.sessionStart,
        env: GROK_ENV,
        shouldOmitExporterEnv: true,
        readCliConfig: () => ({
          control_plane_url: "https://app.example.com",
          default_personal_ingest_keys: { grok_cli: { secret: "ik-lw-grok" } },
        }),
      });

      expect(posted[0]!.headers.Authorization).toBe("Bearer ik-lw-grok");
    });
  });

  describe("given Grok's SubagentStart payload, which fires in the parent", () => {
    /** @scenario A SubagentStart payload posts the child's record with its parent */
    it("posts the child's record, linked to the parent, on the parent's checkout", async () => {
      await hook.runHook({
        tool: "grok",
        input: grok.subagentStart,
        env: { ...GROK_ENV, GROK_HOOK_EVENT: "subagent_start" },
      });

      expect(posted).toHaveLength(1);
      expect(attributesOf(posted[0]!)).toMatchObject({
        "coding_agent.name": "grok",
        "session.id": grok.subagentStart.subagentId,
        parent_session_id: grok.subagentStart.session_id,
        "vcs.repository.name": "langwatch",
      });
    });
  });

  describe("given a collector that cannot be reached", () => {
    /** @scenario The Grok hook never fails the session */
    it("exits without a code and prints nothing", async () => {
      await hook.runHook({
        tool: "grok",
        input: grok.stop,
        env: GROK_ENV,
        fetchImpl: (() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch,
      });

      expect(hook.stdout).toEqual([]);
      expect(hook.exits).toEqual([]);
    });
  });
});

describe("the Claude Code hook, when Grok is the one running it", () => {
  /** @scenario The Claude Code hook run by Grok posts nothing */
  it("posts nothing and prints nothing", async () => {
    await hook.runHook({ tool: "claude-code", input: grok.sessionStart, env: GROK_ENV });

    expect(posted).toEqual([]);
    expect(hook.stdout).toEqual([]);
    expect(hook.exits).toEqual([]);
  });

  /** @scenario The Claude Code hook outside Grok still reports */
  it("still reports a Claude Code session when no GROK_HOOK_EVENT is set", async () => {
    await hook.runHook({ tool: "claude-code" });

    expect(posted).toHaveLength(1);
    expect(attributesOf(posted[0]!)["coding_agent.name"]).toBe("claude_code");
  });
});

describe("Grok's row in the session context agent table", () => {
  /** @scenario Grok's row carries an owned hook file, as Copilot's does */
  it("is an owned file in Grok's hooks folder, keyed by grok_cli and GROK_SESSION_ID", () => {
    const row = sessionContextAgentFor("grok");

    expect(row).toMatchObject({
      agent: "grok",
      keySourceTypes: ["grok_cli"],
      sessionIdVar: "GROK_SESSION_ID",
      projectDirVar: "GROK_WORKSPACE_ROOT",
    });
    expect(row?.hookTarget.kind).toBe("owned-file");
    expect(row?.hookTarget.resolve().displayPath).toBe("~/.grok/hooks/langwatch.json");
  });
});
