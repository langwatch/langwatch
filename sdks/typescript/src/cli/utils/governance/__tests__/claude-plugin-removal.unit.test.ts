/**
 * Taking the LangWatch Claude Code plugin back off a machine, and deregistering
 * the marketplace it came from, which is what `langwatch logout` does.
 *
 * `node:child_process` is the only thing mocked. The settings file and the
 * plugin state files are real files under a temp HOME.
 *
 * Feature: specs/ai-governance/cli-wrappers/claude-plugin-install.feature
 */

import type * as ChildProcessModule from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import { installClaudePluginHarness } from "./claude-plugin-test-helpers";

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof ChildProcessModule>("node:child_process");
  return { ...actual, spawnSync: spawnSyncMock };
});

const {
  answerClaude,
  commandsRun,
  loadModule,
  readSettings,
  seedInstalledPlugin,
  seedMarketplace,
  writeJson,
} = installClaudePluginHarness({
  spawnSyncMock,
  prefix: "lw-claude-plugin-removal-",
});

describe("uninstallLangwatchClaudePlugin", () => {
  describe("given nothing installed", () => {
    it("reports it absent without spawning anything", async () => {
      const { uninstallLangwatchClaudePlugin } = await loadModule();

      expect(uninstallLangwatchClaudePlugin()).toEqual({ action: "absent" });
      expect(commandsRun()).toEqual([]);
    });
  });

  describe("given the plugin installed", () => {
    it("uninstalls it at user scope", async () => {
      seedInstalledPlugin();
      const { uninstallLangwatchClaudePlugin } = await loadModule();

      expect(uninstallLangwatchClaudePlugin()).toEqual({
        action: "uninstalled",
      });
      expect(commandsRun()).toContain(
        "plugin uninstall langwatch@langwatch --scope user",
      );
    });
  });

  describe("given an uninstall subcommand that fails", () => {
    /** @scenario "A plugin the uninstall subcommand cannot remove is disabled instead" */
    it("switches the plugin off in the settings file, preserving the rest", async () => {
      seedInstalledPlugin();
      writeJson({
        segments: ["settings.json"],
        value: {
          model: "claude-sonnet-5",
          enabledPlugins: { "langwatch@langwatch": true, "other@theirs": true },
        },
      });
      answerClaude({ uninstall: 1 });
      const { uninstallLangwatchClaudePlugin } = await loadModule();

      expect(uninstallLangwatchClaudePlugin()).toEqual({ action: "disabled" });

      const after = readSettings<{
        model: string;
        enabledPlugins: Record<string, boolean>;
      }>();
      expect(after.enabledPlugins["langwatch@langwatch"]).toBe(false);
      expect(after.enabledPlugins["other@theirs"]).toBe(true);
      expect(after.model).toBe("claude-sonnet-5");
    });

    /** @scenario "A second logout leaves capture off rather than reporting a failure" */
    it("reports the plugin disabled when a previous logout already switched it off", async () => {
      seedInstalledPlugin();
      writeJson({
        segments: ["settings.json"],
        value: { enabledPlugins: { "langwatch@langwatch": false } },
      });
      answerClaude({ uninstall: 1 });
      const { uninstallLangwatchClaudePlugin } = await loadModule();

      expect(uninstallLangwatchClaudePlugin()).toEqual({ action: "disabled" });
    });
  });
});

describe("removeLangwatchClaudeMarketplace", () => {
  describe("given the marketplace LangWatch registered", () => {
    it("removes it", async () => {
      seedMarketplace();
      const { removeLangwatchClaudeMarketplace } = await loadModule();

      expect(removeLangwatchClaudeMarketplace()).toBe(true);
      expect(commandsRun()).toContain("plugin marketplace remove langwatch");
    });
  });

  describe("given a same-named marketplace somebody else registered", () => {
    /** @scenario "A marketplace LangWatch did not register is left alone" */
    it("leaves it registered and spawns nothing", async () => {
      seedMarketplace({ repo: "somebody-else/their-plugins" });
      const { removeLangwatchClaudeMarketplace } = await loadModule();

      expect(removeLangwatchClaudeMarketplace()).toBe(false);
      expect(commandsRun()).toEqual([]);
    });
  });
});
