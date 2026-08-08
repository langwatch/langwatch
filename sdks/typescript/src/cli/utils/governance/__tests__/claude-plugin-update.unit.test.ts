/**
 * Keeping the installed LangWatch plugin up to date: when a wrapped run spends
 * a subprocess looking, what it does with what it finds, and what it costs on
 * the runs in between.
 *
 * `node:child_process` is the only thing mocked. The install record, the
 * marketplace listing and its plugin manifest are real files under a temp HOME,
 * because the version comparison reads them the way Claude Code writes them and
 * a hand-stubbed reader would prove nothing about that.
 *
 * Feature: specs/ai-governance/cli-wrappers/claude-plugin-update.feature
 */

import { writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type * as ChildProcessModule from "node:child_process";

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
  readConfig,
  seedInstalledPlugin,
  seedMarketplace,
  writeConfig,
  writeJson,
} = installClaudePluginHarness({
  spawnSyncMock,
  prefix: "lw-claude-plugin-update-",
});

const OK = { status: 0, stdout: "", stderr: "" };

const HOUR_MS = 60 * 60 * 1000;

const secondsAgo = (ms: number): number => Math.floor((Date.now() - ms) / 1000);

/**
 * A `claude` whose `plugin update` does what a real one does: moves the version
 * in the install record. Nothing else about the outcome is observable, and a
 * mock that only reported success would let a no-op update pass as an applied
 * one.
 */
const claudeThatUpdatesTo = (version: string): void => {
  spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
    if (args.join(" ").startsWith("plugin update")) {
      seedInstalledPlugin({ version });
    }
    return OK;
  });
};

/** The common starting point: an install one release behind the listing. */
const seedOutdatedInstall = (): void => {
  seedInstalledPlugin({ version: "0.1.0" });
  seedMarketplace({ publishedVersion: "0.2.0" });
};

describe("updateLangwatchClaudePlugin", () => {
  describe("given a plugin the marketplace has moved past", () => {
    /** @scenario "A plugin the marketplace has moved past is updated before the tool starts" */
    it("refreshes the listing, then updates the plugin", async () => {
      seedOutdatedInstall();
      claudeThatUpdatesTo("0.2.0");
      const { updateLangwatchClaudePlugin } = await loadModule();

      const result = updateLangwatchClaudePlugin();

      expect(result).toEqual({ action: "updated", from: "0.1.0", to: "0.2.0" });
      expect(commandsRun()).toEqual([
        "plugin --help",
        "plugin marketplace update langwatch",
        "plugin update langwatch@langwatch --scope user",
      ]);
    });

    /** @scenario "The plugin is kept current from a machine that wraps another tool" */
    it("updates on a machine that only ever wraps codex", async () => {
      writeConfig({ tool_mode: { codex: "ingestion" } });
      seedOutdatedInstall();
      claudeThatUpdatesTo("0.2.0");
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin().action).toBe("updated");
    });

    /** @scenario "An update that will not apply warns" */
    it("reports the failure with the version it was reaching for", async () => {
      seedOutdatedInstall();
      answerClaude({ update: 1 });
      const { updateLangwatchClaudePlugin } = await loadModule();

      const result = updateLangwatchClaudePlugin();

      expect(result.action).toBe("failed");
      expect(result.reason).toContain("0.2.0");
      expect(result.reason).toContain("update rejected");
    });

    it("claims no new version when the update did not apply", async () => {
      seedOutdatedInstall();
      answerClaude({ update: 1 });
      const { updateLangwatchClaudePlugin } = await loadModule();

      // `to` means "the version now installed", and nothing was installed.
      expect(updateLangwatchClaudePlugin().to).toBeUndefined();
    });

    /** @scenario "A run that waits on the network says what it is waiting for" */
    it("announces the check before the first subprocess", async () => {
      seedOutdatedInstall();
      const spawnsWhenAnnounced: number[] = [];
      claudeThatUpdatesTo("0.2.0");
      const { updateLangwatchClaudePlugin } = await loadModule();

      updateLangwatchClaudePlugin({
        onCheckStart: () =>
          spawnsWhenAnnounced.push(spawnSyncMock.mock.calls.length),
      });

      // Announced once, and before anything reached the network. The probe is
      // the only spawn allowed to precede it: it decides whether there is a
      // check to announce at all.
      expect(spawnsWhenAnnounced).toEqual([1]);
    });

    /** @scenario "A claude that cannot manage plugins is left alone" */
    it("does not try to update through a claude with no plugin subcommand", async () => {
      seedOutdatedInstall();
      answerClaude({ pluginHelp: 1 });
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin().action).toBe("unavailable");
      expect(commandsRun()).toEqual(["plugin --help"]);
    });
  });

  describe("given a plugin already at the published version", () => {
    /** @scenario "A plugin already at the published version is left alone" */
    it("refreshes the listing and stops there", async () => {
      seedInstalledPlugin({ version: "0.2.0" });
      seedMarketplace({ publishedVersion: "0.2.0" });
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin()).toEqual({
        action: "up_to_date",
        from: "0.2.0",
      });
      expect(commandsRun()).not.toContain(
        "plugin update langwatch@langwatch --scope user",
      );
    });

    it("leaves an install ahead of the listing where it is", async () => {
      seedInstalledPlugin({ version: "0.9.0" });
      seedMarketplace({ publishedVersion: "0.2.0" });
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin().action).toBe("up_to_date");
    });
  });

  describe("given nothing of ours to keep current", () => {
    /** @scenario "A machine without the plugin is not asked about it" */
    it("spends no subprocess when the plugin is not installed", async () => {
      seedMarketplace({ publishedVersion: "0.2.0" });
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin()).toEqual({ action: "absent" });
      expect(commandsRun()).toEqual([]);
    });

    /** @scenario "A marketplace of our name that somebody else registered is left alone" */
    it("does not update through a marketplace pointing somewhere else", async () => {
      seedInstalledPlugin({ version: "0.1.0" });
      seedMarketplace({ repo: "someone-else/plugins", publishedVersion: "0.2.0" });
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin().action).toBe("unavailable");
      expect(commandsRun()).toEqual([]);
    });

    /** @scenario "A config that cannot be read stops the check rather than repeating it" */
    it("does not check at all when the config will not parse", async () => {
      seedOutdatedInstall();
      writeFileSync(process.env.LANGWATCH_CLI_CONFIG!, "{ not json");
      const { updateLangwatchClaudePlugin } = await loadModule();

      // A stamp that cannot be written is a check that would otherwise repeat
      // on every single launch, forever.
      expect(updateLangwatchClaudePlugin().action).toBe("unavailable");
      expect(commandsRun()).toEqual([]);
    });

    it("leaves a plugin installed only for a project alone", async () => {
      seedInstalledPlugin({ version: "0.1.0", scope: "project" });
      seedMarketplace({ publishedVersion: "0.2.0" });
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin().action).toBe("unknown_version");
    });

    /** @scenario "A version that cannot be read is left alone rather than blindly updated" */
    it("does not update against a listing whose manifest cannot be read", async () => {
      seedInstalledPlugin({ version: "0.1.0" });
      seedMarketplace();
      const { updateLangwatchClaudePlugin } = await loadModule();

      const result = updateLangwatchClaudePlugin();

      expect(result.action).toBe("unknown_version");
      expect(commandsRun()).not.toContain(
        "plugin update langwatch@langwatch --scope user",
      );
    });

    it("does not update against a version it cannot make sense of", async () => {
      seedInstalledPlugin({ version: "0.1.0" });
      seedMarketplace();
      writeJson({
        segments: [
          "plugins",
          "marketplaces",
          "langwatch",
          ".claude-plugin",
          "plugin.json",
        ],
        value: { name: "langwatch", version: "main" },
      });
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin().action).toBe("unknown_version");
    });
  });

  describe("given a check that already ran", () => {
    /** @scenario "A plugin checked today is not checked again" */
    it("spends no subprocess an hour later", async () => {
      seedOutdatedInstall();
      writeConfig({ claude_plugin_last_update_check: secondsAgo(HOUR_MS) });
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin()).toEqual({
        action: "checked_recently",
      });
      expect(commandsRun()).toEqual([]);
    });

    /** @scenario "A run that answers from disk says nothing at all" */
    it("announces nothing on a run that does no work", async () => {
      seedOutdatedInstall();
      writeConfig({ claude_plugin_last_update_check: secondsAgo(HOUR_MS) });
      const onCheckStart = vi.fn();
      const { updateLangwatchClaudePlugin } = await loadModule();

      updateLangwatchClaudePlugin({ onCheckStart });

      expect(onCheckStart).not.toHaveBeenCalled();
    });

    /** @scenario "A day after the last check the plugin is checked again" */
    it("checks again two days later", async () => {
      seedOutdatedInstall();
      writeConfig({
        claude_plugin_last_update_check: secondsAgo(48 * HOUR_MS),
      });
      claudeThatUpdatesTo("0.2.0");
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin().action).toBe("updated");
      expect(commandsRun()).toContain("plugin marketplace update langwatch");
    });

    /** @scenario "A check stamped in the future does not suppress the next one" */
    it("checks rather than waiting for the clock to catch up", async () => {
      seedOutdatedInstall();
      writeConfig({
        claude_plugin_last_update_check: secondsAgo(-365 * 24 * HOUR_MS),
      });
      claudeThatUpdatesTo("0.2.0");
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin().action).toBe("updated");
    });
  });

  describe("given a marketplace listing that will not refresh", () => {
    /** @scenario "A marketplace listing that will not refresh warns and gives up for the day" */
    it("reports the failure rather than claiming the stale listing is current", async () => {
      seedInstalledPlugin({ version: "0.1.0" });
      seedMarketplace({ publishedVersion: "0.1.0" });
      answerClaude({ marketplaceUpdate: 1 });
      const { updateLangwatchClaudePlugin } = await loadModule();

      const result = updateLangwatchClaudePlugin();

      expect(result.action).toBe("failed");
      expect(result.reason).toContain("listing refresh rejected");
    });

    it("stamps the check so the next run does not repeat it", async () => {
      seedInstalledPlugin({ version: "0.1.0" });
      seedMarketplace({ publishedVersion: "0.1.0" });
      answerClaude({ marketplaceUpdate: 1 });
      const { updateLangwatchClaudePlugin } = await loadModule();
      updateLangwatchClaudePlugin();

      expect(readConfig().claude_plugin_last_update_check).toBeTypeOf("number");

      spawnSyncMock.mockClear();
      const next = await loadModule();
      expect(next.updateLangwatchClaudePlugin().action).toBe("checked_recently");
      expect(commandsRun()).toEqual([]);
    });

    it("still applies an update the stale listing already knows about", async () => {
      seedInstalledPlugin({ version: "0.1.0" });
      seedMarketplace({ publishedVersion: "0.2.0" });
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
        const joined = args.join(" ");
        if (joined.startsWith("plugin marketplace update")) {
          return { ...OK, status: 1, stderr: "offline" };
        }
        if (joined.startsWith("plugin update")) {
          seedInstalledPlugin({ version: "0.2.0" });
        }
        return OK;
      });
      const { updateLangwatchClaudePlugin } = await loadModule();

      expect(updateLangwatchClaudePlugin().action).toBe("updated");
    });
  });

  describe("given a subprocess that throws", () => {
    it("returns a failure rather than taking the launch down with it", async () => {
      seedOutdatedInstall();
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
        if (args.join(" ") === "plugin --help") return OK;
        throw new Error("spawn exploded");
      });
      const { updateLangwatchClaudePlugin } = await loadModule();

      const result = updateLangwatchClaudePlugin();

      expect(result.action).toBe("failed");
      expect(result.reason).toContain("spawn exploded");
    });
  });
});
