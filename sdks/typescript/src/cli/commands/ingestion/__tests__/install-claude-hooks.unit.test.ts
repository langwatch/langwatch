/**
 * Activating claude_code capture wires the session context hooks into the
 * user's Claude Code settings, the same run that mints the ingest key.
 *
 * The mint is the only thing faked: the config is a real file behind
 * LANGWATCH_CLI_CONFIG, and the settings file the command merges into is a
 * real file in a temp directory.
 *
 * Feature: specs/ai-governance/cli-wrappers/claude-session-context-hook.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as CliApiModule from "@/cli/utils/governance/cli-api";
import { SESSION_CONTEXT_HOOK_COMMAND } from "@/cli/utils/governance/claude-hooks";

const mintIngestionKeyMock = vi.fn();
vi.mock("@/cli/utils/governance/cli-api", async () => {
  const actual = await vi.importActual<typeof CliApiModule>(
    "@/cli/utils/governance/cli-api",
  );
  return { ...actual, mintIngestionKey: mintIngestionKeyMock };
});

const ourEntry = {
  hooks: [
    { type: "command", command: SESSION_CONTEXT_HOOK_COMMAND, timeout: 10 },
  ],
};

const userEntry = {
  hooks: [{ type: "command", command: "./scripts/session-log.sh" }],
};

let tmpDir: string;
let settingsPath: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
const origConfig = process.env.LANGWATCH_CLI_CONFIG;

const readSettings = (): Record<string, any> =>
  JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, any>;

const runInstall = async (): Promise<void> => {
  const { installCommand } = await import("../install.js");
  await installCommand("claude_code", { claudeSettingsPath: settingsPath });
};

const stdout = (): string =>
  stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-install-hooks-"));
  settingsPath = path.join(tmpDir, ".claude", "settings.json");

  const configPath = path.join(tmpDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      access_token: "tok",
      control_plane_url: "http://app.example.com",
      gateway_url: "http://gateway.example.com",
      organization: { id: "o1", slug: "acme" },
    }),
  );
  process.env.LANGWATCH_CLI_CONFIG = configPath;

  mintIngestionKeyMock.mockResolvedValue({
    token: "ik-lw-abc0000000000000_secret",
    prefix: "ik-lw-abc0000000000000",
    endpoint: "http://app.example.com/api/otel",
  });
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  if (origConfig === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
  else process.env.LANGWATCH_CLI_CONFIG = origConfig;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("the claude_code ingestion install", () => {
  describe("given a settings file without the langwatch hooks", () => {
    /** @scenario "Installing claude_code merges the SessionStart and Stop hooks idempotently" */
    it("leaves exactly one langwatch entry per hook event after two runs", async () => {
      await runInstall();
      await runInstall();

      expect(readSettings().hooks).toEqual({
        SessionStart: [ourEntry],
        Stop: [ourEntry],
      });
    });

    it("reports what it did to the settings file", async () => {
      await runInstall();
      expect(stdout()).toContain(`${settingsPath} session hooks created`);

      stdoutSpy.mockClear();
      await runInstall();
      expect(stdout()).toContain(
        `${settingsPath} session hooks already up to date`,
      );
    });

    it("carries the action in the json report", async () => {
      const { installCommand } = await import("../install.js");
      await installCommand("claude_code", {
        claudeSettingsPath: settingsPath,
        json: true,
      });

      const report = JSON.parse(stdout()) as {
        claude_hooks_action: string;
        claude_hooks_path: string;
      };
      expect(report.claude_hooks_action).toBe("created");
      expect(report.claude_hooks_path).toBe(settingsPath);
    });

    it("writes no hooks when only the exports were asked for", async () => {
      const { installCommand } = await import("../install.js");
      await installCommand("claude_code", {
        claudeSettingsPath: settingsPath,
        envOnly: true,
      });

      expect(fs.existsSync(settingsPath)).toBe(false);
    });
  });

  describe("given a settings file with the user's own SessionStart hook", () => {
    beforeEach(() => {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(
          { model: "claude-sonnet-5", hooks: { SessionStart: [userEntry] } },
          null,
          2,
        ),
      );
    });

    /** @scenario "User-authored hooks survive the merge untouched" */
    it("keeps the user's entry exactly as it was, with ours alongside", async () => {
      await runInstall();

      const settings = readSettings();
      expect(settings.hooks.SessionStart).toEqual([userEntry, ourEntry]);
      expect(settings.model).toBe("claude-sonnet-5");
    });
  });
});
