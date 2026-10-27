/**
 * The table must leave Claude Code, Codex and opencode byte-identical: the
 * expected bytes and digests were captured from the CLI before it existed.
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installOpencodeSessionContextPlugin } from "@/cli/utils/governance/opencode-plugin";
import { installSessionContextHooks } from "@/cli/utils/governance/session-context-hooks";
import { LANGWATCH_SDK_VERSION } from "@/internal/constants";

import {
  attributesOf,
  installHookHarness,
  type PostedRequest,
  recordOf,
  SESSION_ID,
} from "./hook-harness";

const hook = installHookHarness();
const { posted } = hook;

const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The posted body with the CLI's own version taken out, the one part of it
 * that moves with every release, digested so a change anywhere else shows.
 */
const bodyDigest = (request: PostedRequest): string =>
  sha256(JSON.stringify(request.body).replaceAll(LANGWATCH_SDK_VERSION, "<version>"));

/** Every agent's personal key, so a lookup that reads the wrong slot shows. */
const SIGNED_IN = () => ({
  control_plane_url: "https://app.example.com",
  default_personal_ingest_keys: {
    claude_code: { secret: "ik-lw-personal-claude_code" },
    codex: { secret: "ik-lw-personal-codex" },
    opencode: { secret: "ik-lw-personal-opencode" },
  },
});

/** Every agent's pin, keyed by tool slug the way `langwatch instrument` writes it. */
const PINNED = () => ({
  control_plane_url: "https://app.example.com",
  tool_project_keys: {
    claude: { secret: "sk-lw-pinned-claude", project_id: "project-claude" },
    codex: { secret: "sk-lw-pinned-codex", project_id: "project-codex" },
    opencode: { secret: "sk-lw-pinned-opencode", project_id: "project-opencode" },
  },
});

const hookEntry = (...commands: string[]) => ({
  hooks: commands.map((command) => ({ type: "command", command, timeout: 10 })),
});

const CLAUDE_SETTINGS_BEFORE_THE_TABLE = `${JSON.stringify(
  {
    hooks: {
      SessionStart: [
        hookEntry("langwatch ingest hook claude-code", "langwatch ingest guidance claude-code"),
      ],
      Stop: [hookEntry("langwatch ingest hook claude-code")],
    },
  },
  null,
  2,
)}\n`;

const CODEX_HOOKS_BEFORE_THE_TABLE = `${JSON.stringify(
  {
    hooks: {
      SessionStart: [hookEntry("langwatch ingest hook codex")],
      Stop: [hookEntry("langwatch ingest hook codex")],
    },
  },
  null,
  2,
)}\n`;

const OPENCODE_PLUGIN_SHA256_BEFORE_THE_TABLE =
  "8e99fa82b16529cf24970b14bef4d688b774d9d3d6c6d3c95de2deb29144a21d";

/** The posted body per agent before the table, version taken out. */
const BODY_SHA256_BEFORE_THE_TABLE: Record<string, string> = {
  "claude-code": "2eab9c531b1d7d075bf676f9ba376fe596f156989f2efad71ed68ef26b46828b",
  codex: "8b944bcf503a1c94f0ef32ad366d8da4af32dcd12538f39689437a605a4361e0",
  opencode: "4636a3bb49018f3d634f98e2577afd0e3d1ed0ea9d775caf2b7c861d92d562fc",
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-hook-agent-table-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("the per-agent hook table", () => {
  describe("when the hooks are installed for Claude Code, Codex and opencode", () => {
    /** @scenario "Every agent's hook wiring comes from one per-agent table" */
    it("writes the same hook files as before the table", () => {
      const claudeSettings = path.join(tmpDir, "claude-settings.json");
      const codexHooks = path.join(tmpDir, "codex-hooks.json");

      installSessionContextHooks({ tool: "claude_code", filePath: claudeSettings });
      installSessionContextHooks({ tool: "codex", filePath: codexHooks });
      const opencode = installOpencodeSessionContextPlugin({
        dirPath: path.join(tmpDir, "opencode-plugins"),
      });

      expect(fs.readFileSync(claudeSettings, "utf8")).toBe(CLAUDE_SETTINGS_BEFORE_THE_TABLE);
      expect(fs.readFileSync(codexHooks, "utf8")).toBe(CODEX_HOOKS_BEFORE_THE_TABLE);
      expect(sha256(fs.readFileSync(opencode.path))).toBe(OPENCODE_PLUGIN_SHA256_BEFORE_THE_TABLE);
    });
  });

  describe("when the hook runs for Claude Code, Codex and opencode", () => {
    /** @scenario "Every agent's hook wiring comes from one per-agent table" */
    it.each([
      ["claude-code", "claude_code"],
      ["codex", "codex"],
      ["opencode", "opencode"],
    ])("posts the same %s record, with the personal key cached for it", async (tool, agent) => {
      await hook.runHook({ tool, shouldOmitExporterEnv: true, readCliConfig: SIGNED_IN });

      expect(posted).toHaveLength(1);
      expect(posted[0]!.url).toBe("https://app.example.com/api/otel/v1/logs");
      expect(posted[0]!.headers.Authorization).toBe(`Bearer ik-lw-personal-${agent}`);
      expect(recordOf(posted[0]!).eventName).toBe("langwatch.session_context");
      expect(attributesOf(posted[0]!)).toEqual({
        "event.name": "langwatch.session_context",
        "session.id": SESSION_ID,
        "coding_agent.name": agent,
        "vcs.repository.host": "github.com",
        "vcs.repository.owner": "langwatch",
        "vcs.repository.name": "langwatch",
        "vcs.ref.head.name": "feat/session-context",
        "vcs.worktree.name": "review",
      });
      expect(bodyDigest(posted[0]!)).toBe(BODY_SHA256_BEFORE_THE_TABLE[tool]);
    });

    /** @scenario "Every agent's hook wiring comes from one per-agent table" */
    it.each([
      ["claude-code", "claude"],
      ["codex", "codex"],
      ["opencode", "opencode"],
    ])("posts the %s record with the key pinned for its tool slug", async (tool, slug) => {
      await hook.runHook({ tool, shouldOmitExporterEnv: true, readCliConfig: PINNED });

      expect(posted).toHaveLength(1);
      expect(posted[0]!.headers.Authorization).toBe(`Bearer sk-lw-pinned-${slug}`);
    });
  });
});
