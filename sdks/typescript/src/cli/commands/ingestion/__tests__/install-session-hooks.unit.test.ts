/**
 * Activating capture wires each tool's session context seam, the same run that
 * mints the ingest key: hook entries for Claude Code and Codex, a plugin file
 * for opencode.
 *
 * The mint is the only thing faked: the config is a real file behind
 * LANGWATCH_CLI_CONFIG, and the files the command merges into or writes are
 * real files in a temp directory.
 *
 * `claude` here is one without plugin support, so claude_code lands on the hook
 * entries rather than the LangWatch plugin. What the plugin path reports lives
 * in install-claude-plugin.unit.test.ts.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import type * as ChildProcessModule from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as CliApiModule from "@/cli/utils/governance/cli-api";
import {
  OPENCODE_HOOK_COMMAND,
  OPENCODE_PLUGIN_FILE_NAME,
} from "@/cli/utils/governance/opencode-plugin";
import { sessionContextHookCommand } from "@/cli/utils/governance/session-context-hooks";

// Hoisted, because the factory below is: a plain top-level const is still in
// its temporal dead zone if anything on the static import graph reaches
// cli-api before this line runs.
const { mintIngestionKeyMock } = vi.hoisted(() => ({
  mintIngestionKeyMock: vi.fn(),
}));

vi.mock("@/cli/utils/governance/cli-api", async () => {
  const actual = await vi.importActual<typeof CliApiModule>(
    "@/cli/utils/governance/cli-api",
  );
  return { ...actual, mintIngestionKey: mintIngestionKeyMock };
});

// No test may reach a real `claude`. A non-zero `plugin --help` is exactly what
// a release without the subcommand answers, so the install falls back to the
// hook entries these scenarios are about.
const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(() => ({ status: 1, stdout: "", stderr: "unknown" })),
}));
vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof ChildProcessModule>("node:child_process");
  return { ...actual, spawnSync: spawnSyncMock };
});

const entryFor = (tool: "claude_code" | "codex") => ({
  hooks: [
    { type: "command", command: sessionContextHookCommand(tool), timeout: 10 },
  ],
});

// Claude's SessionStart entry carries the guidance hook as a second command:
// same entry, so the one-langwatch-entry-per-event invariant holds.
const ourSessionStartEntry = {
  hooks: [
    {
      type: "command",
      command: sessionContextHookCommand("claude_code"),
      timeout: 10,
    },
    { type: "command", command: "langwatch ingest guidance claude-code", timeout: 10 },
  ],
};

const ourEntry = entryFor("claude_code");

const userEntry = {
  hooks: [{ type: "command", command: "./scripts/session-log.sh" }],
};

let tmpDir: string;
let settingsPath: string;
let codexHooksPath: string;
let codexConfigPath: string;
let opencodePluginDir: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
const origConfig = process.env.LANGWATCH_CLI_CONFIG;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;

const readJson = (file = settingsPath): Record<string, any> =>
  JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, any>;

const runInstall = async (): Promise<void> => {
  const { installCommand } = await import("../install.js");
  await installCommand("claude_code", { hooksPath: settingsPath });
};

const runCodexInstall = async (): Promise<void> => {
  const { installCommand } = await import("../install.js");
  await installCommand("codex", { hooksPath: codexHooksPath, codexConfigPath });
};

const runOpencodeInstall = async (): Promise<void> => {
  const { installCommand } = await import("../install.js");
  await installCommand("opencode", { opencodePluginDir });
};

const stdout = (): string =>
  stdoutSpy.mock.calls.map((call: unknown[]) => String(call[0])).join("");

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-install-hooks-"));
  // The claude plugin state lives under the home directory, so point HOME at
  // the temp directory too: what the developer running these tests happens to
  // have installed must never decide which seam the install picks.
  process.env.HOME = tmpDir;
  process.env.USERPROFILE = tmpDir;
  settingsPath = path.join(tmpDir, ".claude", "settings.json");
  codexHooksPath = path.join(tmpDir, ".codex", "hooks.json");
  codexConfigPath = path.join(tmpDir, ".codex", "config.toml");
  opencodePluginDir = path.join(tmpDir, ".config", "opencode", "plugins");

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
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserprofile;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("the claude_code ingestion install", () => {
  describe("given a settings file without the langwatch hooks", () => {
    /** @scenario "Installing claude_code merges the SessionStart and Stop hooks idempotently" */
    it("leaves exactly one langwatch entry per hook event after two runs", async () => {
      await runInstall();
      await runInstall();

      expect(readJson().hooks).toEqual({
        SessionStart: [ourSessionStartEntry],
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
        hooksPath: settingsPath,
        json: true,
      });

      const report = JSON.parse(stdout()) as {
        session_hooks_action: string;
        session_hooks_path: string;
      };
      expect(report.session_hooks_action).toBe("created");
      expect(report.session_hooks_path).toBe(settingsPath);
    });

    it("writes no hooks when only the exports were asked for", async () => {
      const { installCommand } = await import("../install.js");
      await installCommand("claude_code", {
        hooksPath: settingsPath,
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
    /** @scenario "The raw claude hooks carry the guidance entry" */
    it("keeps the user's entry exactly as it was, with ours alongside", async () => {
      await runInstall();

      const settings = readJson();
      expect(settings.hooks.SessionStart).toEqual([
        userEntry,
        ourSessionStartEntry,
      ]);
      expect(settings.model).toBe("claude-sonnet-5");
    });
  });
});

describe("the codex ingestion install", () => {
  describe("given a codex hooks file without the langwatch hooks", () => {
    /** @scenario "Installing codex merges the same hooks into the codex hooks file" */
    it("leaves exactly one langwatch entry per hook event, running the codex command", async () => {
      await runCodexInstall();
      await runCodexInstall();

      expect(readJson(codexHooksPath).hooks).toEqual({
        SessionStart: [entryFor("codex")],
        Stop: [entryFor("codex")],
      });
      expect(sessionContextHookCommand("codex")).toBe(
        "langwatch ingest hook codex",
      );
    });

    /** @scenario "The codex install tells the user Codex asks for review once" */
    it("says Codex asks the user to review the hook before it runs", async () => {
      await runCodexInstall();

      expect(stdout()).toContain(`${codexHooksPath} session hooks created`);
      expect(stdout()).toContain(
        "Codex asks you to review a newly added hook the next time you start it",
      );
    });

    it("still writes the otel activation block it always wrote", async () => {
      await runCodexInstall();

      expect(fs.readFileSync(codexConfigPath, "utf8")).toContain("[otel]");
    });

    it("writes no hooks when only the exports were asked for", async () => {
      const { installCommand } = await import("../install.js");
      await installCommand("codex", {
        hooksPath: codexHooksPath,
        codexConfigPath,
        envOnly: true,
      });

      expect(fs.existsSync(codexHooksPath)).toBe(false);
    });
  });
});

describe("the opencode ingestion install", () => {
  describe("given a plugin directory without the langwatch plugin", () => {
    /** @scenario "Installing opencode writes the session context plugin" */
    it("leaves exactly one plugin file after two runs, running the opencode command", async () => {
      await runOpencodeInstall();
      await runOpencodeInstall();

      expect(fs.readdirSync(opencodePluginDir)).toEqual([
        OPENCODE_PLUGIN_FILE_NAME,
      ]);
      expect(
        fs.readFileSync(
          path.join(opencodePluginDir, OPENCODE_PLUGIN_FILE_NAME),
          "utf8",
        ),
      ).toContain(JSON.stringify(OPENCODE_HOOK_COMMAND.split(" ")));
    });

    it("reports what it did and says the user's own plugins are untouched", async () => {
      await runOpencodeInstall();

      expect(stdout()).toContain("session plugin created");
      expect(stdout()).toContain("Your own plugins are");
    });

    it("writes no plugin when only the exports were asked for", async () => {
      const { installCommand } = await import("../install.js");
      await installCommand("opencode", { opencodePluginDir, envOnly: true });

      expect(fs.existsSync(opencodePluginDir)).toBe(false);
    });
  });
});
