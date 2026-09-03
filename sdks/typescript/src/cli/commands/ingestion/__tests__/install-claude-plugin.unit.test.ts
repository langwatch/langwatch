/**
 * `langwatch ingest install claude_code` wires the session context seam the same
 * way a consented wrapper run does: the LangWatch Claude Code plugin when this
 * `claude` can take one, the hook entries in the settings file when it cannot.
 *
 * The report has to say which of the two actually happened. A report claiming
 * hooks were written when the plugin took them sends the next reader looking for
 * entries that are not there.
 *
 * Feature: specs/ai-governance/cli-wrappers/claude-plugin-install.feature
 */

import type * as ChildProcessModule from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as CliApiModule from "@/cli/utils/governance/cli-api";

const { mintIngestionKeyMock, spawnSyncMock } = vi.hoisted(() => ({
  mintIngestionKeyMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));

vi.mock("@/cli/utils/governance/cli-api", async () => {
  const actual = await vi.importActual<typeof CliApiModule>("@/cli/utils/governance/cli-api");
  return { ...actual, mintIngestionKey: mintIngestionKeyMock };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof ChildProcessModule>("node:child_process");
  return { ...actual, spawnSync: spawnSyncMock };
});

let tmpDir: string;
let settingsPath: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
const origConfig = process.env.LANGWATCH_CLI_CONFIG;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;

const ok = { status: 0, stdout: "", stderr: "" };

const claudeWithPlugins = (): void => {
  spawnSyncMock.mockReturnValue(ok);
};
const claudeWithoutPlugins = (): void => {
  spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "unknown" });
};

const stdout = (): string =>
  stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("");

interface Report {
  claude_plugin_action?: string;
  session_hooks_action?: string;
  session_hooks_path?: string;
}

const runInstall = async (): Promise<Report> => {
  vi.resetModules();
  const { installCommand } = await import("../install.js");
  await installCommand("claude_code", { hooksPath: settingsPath, json: true });
  return JSON.parse(stdout()) as Report;
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-install-plugin-"));
  process.env.HOME = tmpDir;
  process.env.USERPROFILE = tmpDir;
  settingsPath = path.join(tmpDir, ".claude", "settings.json");

  const configPath = path.join(tmpDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      access_token: "tok",
      control_plane_url: "http://app.example.com",
      gateway_url: "http://gateway.example.com",
    }),
  );
  process.env.LANGWATCH_CLI_CONFIG = configPath;

  mintIngestionKeyMock.mockResolvedValue({
    token: "ik-lw-abc0000000000000_secret",
    prefix: "ik-lw-abc0000000000000",
    endpoint: "http://app.example.com/api/otel",
  });
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  spawnSyncMock.mockReset();
});

afterEach(() => {
  stdoutSpy.mockRestore();
  if (origConfig === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
  else process.env.LANGWATCH_CLI_CONFIG = origConfig;
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserprofile;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("the claude_code ingestion install", () => {
  describe("given a claude binary that supports plugins", () => {
    beforeEach(() => claudeWithPlugins());

    /** @scenario "The claude_code install reports the plugin action" */
    it("reports the plugin installed and no session hooks", async () => {
      const report = await runInstall();

      expect(report.claude_plugin_action).toBe("installed");
      expect(report.session_hooks_action).toBeUndefined();
      expect(report.session_hooks_path).toBeUndefined();
    });

    it("writes no hook entries into the settings file", async () => {
      await runInstall();

      expect(fs.existsSync(settingsPath)).toBe(false);
    });

    it("names the plugin in the human report", async () => {
      vi.resetModules();
      const { installCommand } = await import("../install.js");
      await installCommand("claude_code", { hooksPath: settingsPath });

      expect(stdout()).toContain("LangWatch Claude Code plugin installed");
    });
  });

  describe("given a claude binary with no plugin subcommand", () => {
    beforeEach(() => claudeWithoutPlugins());

    /** @scenario "The claude_code install reports the raw hooks when it fell back" */
    it("reports the plugin unavailable and the hooks it wrote instead", async () => {
      const report = await runInstall();

      expect(report.claude_plugin_action).toBe("unavailable");
      expect(report.session_hooks_action).toBe("created");
      expect(report.session_hooks_path).toBe(settingsPath);
    });

    it("writes the hook entries into the settings file", async () => {
      await runInstall();

      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      expect(Object.keys(settings.hooks as object)).toEqual(["SessionStart", "Stop"]);
    });
  });

  describe("given only the exports were asked for", () => {
    it("neither installs the plugin nor writes hook entries", async () => {
      claudeWithPlugins();
      vi.resetModules();
      const { installCommand } = await import("../install.js");
      await installCommand("claude_code", {
        hooksPath: settingsPath,
        envOnly: true,
        json: true,
      });

      const report = JSON.parse(stdout()) as Report;
      expect(report.claude_plugin_action).toBeUndefined();
      expect(report.session_hooks_action).toBeUndefined();
      expect(spawnSyncMock).not.toHaveBeenCalled();
    });
  });
});
