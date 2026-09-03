/**
 * Putting the LangWatch Claude Code plugin on a machine: what it asks the
 * `claude` binary to do, what it does when any of that fails, and how long a
 * failure keeps it from trying again.
 *
 * `node:child_process` is the only thing mocked. The settings file, the plugin
 * state files and the CLI config are real files under a temp HOME.
 *
 * Feature: specs/ai-governance/cli-wrappers/claude-plugin-install.feature
 */

import * as fs from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type * as ChildProcessModule from "node:child_process";

import { installClaudePluginHarness } from "./claude-plugin-test-helpers";

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof ChildProcessModule>("node:child_process");
  return { ...actual, spawnSync: spawnSyncMock };
});

const {
  answerClaude,
  commandsRun,
  lastSpawnOptions,
  loadModule,
  readConfig,
  readSettings,
  seedInstalledPlugin,
  seedMarketplace,
  settingsPath,
  writeConfig,
  writeJson,
} = installClaudePluginHarness({
  spawnSyncMock,
  prefix: "lw-claude-plugin-",
});

const rawHookEntry = (timeout?: number) => ({
  hooks: [
    {
      type: "command",
      command: "langwatch ingest hook claude-code",
      ...(timeout === undefined ? {} : { timeout }),
    },
  ],
});

describe("ensureLangwatchClaudePlugin", () => {
  describe("given a claude binary that supports plugins", () => {
    /** @scenario "Saying yes installs the marketplace and the plugin at user scope" */
    it("adds the marketplace, then installs the plugin at user scope", async () => {
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true })).toEqual({
        action: "installed",
      });
      expect(commandsRun()).toEqual([
        "plugin --help",
        "plugin marketplace add langwatch/agent-plugin",
        "plugin install langwatch@langwatch --scope user",
      ]);
    });

    it("hands the terminal to an interactive install and captures a quiet one", async () => {
      const { ensureLangwatchClaudePlugin } = await loadModule();
      ensureLangwatchClaudePlugin({ interactive: true });
      expect(lastSpawnOptions().stdio).toBe("inherit");

      const quiet = await loadModule();
      spawnSyncMock.mockClear();
      quiet.ensureLangwatchClaudePlugin({ interactive: false });
      expect(lastSpawnOptions().stdio).toEqual(["ignore", "pipe", "pipe"]);
    });

    /** @scenario "Installing the plugin removes the raw hook entries it replaces" */
    it("removes the raw hook entries and leaves the user's own", async () => {
      const userEntry = {
        hooks: [{ type: "command", command: "./scripts/mine.sh" }],
      };
      writeJson({
        segments: ["settings.json"],
        value: {
          model: "claude-sonnet-5",
          hooks: { SessionStart: [userEntry, rawHookEntry(10)] },
        },
      });

      const { ensureLangwatchClaudePlugin } = await loadModule();
      ensureLangwatchClaudePlugin({ interactive: true });

      const after = readSettings<{
        hooks: Record<string, unknown[]>;
        model: string;
      }>();
      expect(after.hooks.SessionStart).toEqual([userEntry]);
      expect(after.model).toBe("claude-sonnet-5");
    });
  });

  describe("given the plugin is already installed", () => {
    it("reports it already installed without spawning anything", async () => {
      seedInstalledPlugin();
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true })).toEqual({
        action: "already_installed",
      });
      expect(commandsRun()).toEqual([]);
    });

    it("still clears raw hook entries the plugin replaced", async () => {
      seedInstalledPlugin();
      writeJson({
        segments: ["settings.json"],
        value: { hooks: { Stop: [rawHookEntry()] } },
      });

      const { ensureLangwatchClaudePlugin } = await loadModule();
      ensureLangwatchClaudePlugin({ interactive: true });

      expect(fs.readFileSync(settingsPath(), "utf8")).not.toContain("langwatch ingest hook");
    });
  });

  describe("given a claude binary with no plugin subcommand", () => {
    /** @scenario "A claude without plugin support falls back to the raw hook entries" */
    it("reports the plugin unavailable and attempts no install", async () => {
      answerClaude({ pluginHelp: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true }).action).toBe("unavailable");
      expect(commandsRun()).toEqual(["plugin --help"]);
    });

    it("records no failure, so the next run probes again", async () => {
      answerClaude({ pluginHelp: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();
      ensureLangwatchClaudePlugin({ interactive: true });

      expect(readConfig().claude_plugin_last_failure).toBeUndefined();
    });
  });

  describe("given a marketplace add that reports failure", () => {
    /** @scenario "A marketplace that is already registered survives a failing add" */
    it("installs anyway when the marketplace is registered afterwards", async () => {
      seedMarketplace();
      answerClaude({ marketplaceAdd: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true })).toEqual({
        action: "installed",
      });
      expect(commandsRun()).toContain("plugin install langwatch@langwatch --scope user");
    });

    it("gives up when the marketplace is still unknown afterwards", async () => {
      answerClaude({ marketplaceAdd: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      const result = ensureLangwatchClaudePlugin({ interactive: true });
      expect(result.action).toBe("failed");
      expect(commandsRun()).not.toContain("plugin install langwatch@langwatch --scope user");
    });
  });

  describe("given a plugin install that fails", () => {
    /** @scenario "A failed plugin install falls back to the raw hook entries" */
    it("reports failure with a reason so the caller can fall back", async () => {
      answerClaude({ install: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      const result = ensureLangwatchClaudePlugin({ interactive: true });
      expect(result.action).toBe("failed");
      expect(result.reason).toContain("install rejected");
    });

    it("stamps the failure on the config", async () => {
      answerClaude({ install: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();
      ensureLangwatchClaudePlugin({ interactive: true });

      expect(readConfig().claude_plugin_last_failure).toBeTypeOf("number");
    });

    it("returns rather than throwing when the subprocess throws", async () => {
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
        if (args.join(" ") === "plugin --help") {
          return { status: 0, stdout: "", stderr: "" };
        }
        throw new Error("spawn exploded");
      });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      const result = ensureLangwatchClaudePlugin({ interactive: true });
      expect(result.action).toBe("failed");
    });
  });

  describe("given a failure recorded an hour ago", () => {
    /** @scenario "A failed plugin install is not retried for a day" */
    it("skips the install without spawning anything", async () => {
      writeConfig({
        claude_plugin_last_failure: Math.floor(Date.now() / 1000) - 60 * 60,
      });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true })).toEqual({
        action: "skipped_recent_failure",
      });
      expect(commandsRun()).toEqual([]);
    });
  });

  describe("given a failure recorded two days ago", () => {
    /** @scenario "A day after a failed install the plugin is attempted again" */
    it("attempts the install again and clears the stamp on success", async () => {
      writeConfig({
        claude_plugin_last_failure: Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60,
      });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true }).action).toBe("installed");
      expect(commandsRun()).toContain("plugin install langwatch@langwatch --scope user");
      expect(readConfig().claude_plugin_last_failure).toBeUndefined();
    });
  });

  describe("given a failure stamped in the future", () => {
    /** @scenario "A clock that disagrees with the last failure does not block the retry" */
    it("attempts the install rather than waiting for the clock to catch up", async () => {
      writeConfig({
        claude_plugin_last_failure: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true }).action).toBe("installed");
    });
  });
});
