/**
 * The LangWatch Claude Code plugin seam: what it reads off disk, what it asks
 * the `claude` binary to do, and what it does when any of that fails.
 *
 * `node:child_process` is the only thing mocked. Every file the module reads or
 * writes is a real file under a temp HOME, so the state parsing is exercised
 * against the shapes Claude Code actually writes.
 *
 * Feature: specs/ai-governance/cli-wrappers/claude-plugin-install.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ChildProcessModule from "node:child_process";

import type * as ClaudePluginModuleType from "../claude-plugin";
import {
  OWNED_MARKETPLACE_REPO,
  seedInstalledPlugin as seedInstalledPluginFixture,
  seedMarketplace as seedMarketplaceFixture,
  writeClaudeJson,
} from "./claude-plugin-test-helpers";

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof ChildProcessModule>("node:child_process");
  return { ...actual, spawnSync: spawnSyncMock };
});

type ClaudePluginModule = typeof ClaudePluginModuleType;

let tmpHome: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origConfig = process.env.LANGWATCH_CLI_CONFIG;

/** A fresh module graph per test, so the availability probe is memoized once. */
const loadModule = async (): Promise<ClaudePluginModule> => {
  vi.resetModules();
  return await import("../claude-plugin.js");
};

const ok = { status: 0, stdout: "", stderr: "" };

/** Answers `claude plugin --help` with `status`, everything else with success. */
const claudeWhere = ({
  pluginHelp = 0,
  marketplaceAdd = 0,
  install = 0,
  uninstall = 0,
  marketplaceRemove = 0,
}: {
  pluginHelp?: number;
  marketplaceAdd?: number;
  install?: number;
  uninstall?: number;
  marketplaceRemove?: number;
}): void => {
  // A refusal reason belongs to a refusal: a zero status carrying "rejected"
  // on stderr would let a future assertion about WHY something failed pass
  // against a run that succeeded.
  const answer = (status: number, refusal: string) => ({
    ...ok,
    status,
    stderr: status === 0 ? "" : refusal,
  });
  spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
    const joined = args.join(" ");
    if (joined === "plugin --help") return { ...ok, status: pluginHelp };
    if (joined.startsWith("plugin marketplace add")) {
      return answer(marketplaceAdd, "add rejected");
    }
    if (joined.startsWith("plugin marketplace remove")) {
      return { ...ok, status: marketplaceRemove };
    }
    if (joined.startsWith("plugin install")) {
      return answer(install, "install rejected");
    }
    if (joined.startsWith("plugin uninstall")) {
      return answer(uninstall, "uninstall rejected");
    }
    return ok;
  });
};

const settingsPath = (): string =>
  path.join(tmpHome, ".claude", "settings.json");
/** Only for the cases that write bytes which are deliberately not JSON. */
const pluginsDir = (): string => path.join(tmpHome, ".claude", "plugins");

const writeJson = (segments: string[], value: unknown): void =>
  writeClaudeJson({ home: tmpHome, segments, value });

const seedInstalledPlugin = (): void =>
  seedInstalledPluginFixture({ home: tmpHome });

const seedMarketplace = (repo = OWNED_MARKETPLACE_REPO): void =>
  seedMarketplaceFixture({ home: tmpHome, repo });

const readConfig = (): Record<string, unknown> =>
  JSON.parse(
    fs.readFileSync(process.env.LANGWATCH_CLI_CONFIG!, "utf8"),
  ) as Record<string, unknown>;

const writeConfig = (extra: Record<string, unknown> = {}): void =>
  fs.writeFileSync(
    process.env.LANGWATCH_CLI_CONFIG!,
    JSON.stringify({
      gateway_url: "http://gw.example.com",
      control_plane_url: "http://app.example.com",
      ...extra,
    }),
  );

const commandsRun = (): string[] =>
  spawnSyncMock.mock.calls.map((call: unknown[]) =>
    (call[1] as string[]).join(" "),
  );

const lastSpawnOptions = (): { stdio: unknown } => {
  const calls = spawnSyncMock.mock.calls as unknown[][];
  return calls[calls.length - 1]![2] as { stdio: unknown };
};

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-claude-plugin-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.LANGWATCH_CLI_CONFIG = path.join(tmpHome, "config.json");
  writeConfig();
  spawnSyncMock.mockReset();
  claudeWhere({});
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserprofile;
  if (origConfig === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
  else process.env.LANGWATCH_CLI_CONFIG = origConfig;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("claudePluginCliAvailable", () => {
  describe("when the binary answers `plugin --help`", () => {
    it("reports the subcommand available", async () => {
      const { claudePluginCliAvailable } = await loadModule();
      expect(claudePluginCliAvailable()).toBe(true);
    });

    it("probes once and answers from memory after that", async () => {
      const { claudePluginCliAvailable } = await loadModule();
      claudePluginCliAvailable();
      claudePluginCliAvailable();
      claudePluginCliAvailable();
      expect(commandsRun().filter((c) => c === "plugin --help")).toHaveLength(1);
    });
  });

  describe("when the binary has no plugin subcommand", () => {
    it("reports the subcommand unavailable", async () => {
      claudeWhere({ pluginHelp: 1 });
      const { claudePluginCliAvailable } = await loadModule();
      expect(claudePluginCliAvailable()).toBe(false);
    });
  });

  describe("when the binary is not on PATH at all", () => {
    it("reports the subcommand unavailable rather than throwing", async () => {
      spawnSyncMock.mockReturnValue({
        status: null,
        error: new Error("spawnSync claude ENOENT"),
      });
      const { claudePluginCliAvailable } = await loadModule();
      expect(claudePluginCliAvailable()).toBe(false);
    });
  });
});

describe("readClaudePluginState", () => {
  describe("given no plugin state on disk", () => {
    /** @scenario "Unreadable plugin state reads as nothing installed" */
    it("reports nothing installed, known or enabled", async () => {
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState()).toEqual({
        pluginInstalled: false,
        marketplaceKnown: false,
        marketplaceOwnedByLangwatch: false,
        enabled: false,
      });
    });
  });

  describe("given plugin state files holding malformed JSON", () => {
    it("reports nothing installed rather than throwing", async () => {
      fs.mkdirSync(pluginsDir(), { recursive: true });
      fs.writeFileSync(
        path.join(pluginsDir(), "installed_plugins.json"),
        "{ not json",
      );
      fs.writeFileSync(
        path.join(pluginsDir(), "known_marketplaces.json"),
        "[[[",
      );
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().pluginInstalled).toBe(false);
      expect(readClaudePluginState().marketplaceKnown).toBe(false);
    });
  });

  describe("given an install record for the plugin", () => {
    it("reports the plugin installed", async () => {
      seedInstalledPlugin();
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().pluginInstalled).toBe(true);
    });

    it("reads an empty record array as not installed", async () => {
      writeJson(["plugins", "installed_plugins.json"], {
        version: 2,
        plugins: { "langwatch@langwatch": [] },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().pluginInstalled).toBe(false);
    });

    it("ignores install records belonging to other plugins", async () => {
      writeJson(["plugins", "installed_plugins.json"], {
        version: 2,
        plugins: { "somebody-else@theirs": [{ scope: "user" }] },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().pluginInstalled).toBe(false);
    });
  });

  describe("given a marketplace registered under our name", () => {
    it("claims ownership of a github shorthand source", async () => {
      seedMarketplace();
      const { readClaudePluginState } = await loadModule();
      const state = readClaudePluginState();
      expect(state.marketplaceKnown).toBe(true);
      expect(state.marketplaceOwnedByLangwatch).toBe(true);
    });

    it("claims ownership of a full repository URL source", async () => {
      writeJson(["plugins", "known_marketplaces.json"], {
        langwatch: {
          source: { source: "git", url: "https://github.com/langwatch/agent-plugin.git" },
        },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().marketplaceOwnedByLangwatch).toBe(true);
    });

    it("disclaims a same-named marketplace pointing somewhere else", async () => {
      seedMarketplace("somebody-else/their-plugins");
      const { readClaudePluginState } = await loadModule();
      const state = readClaudePluginState();
      expect(state.marketplaceKnown).toBe(true);
      expect(state.marketplaceOwnedByLangwatch).toBe(false);
    });

    it("disclaims a repository that merely extends our name", async () => {
      seedMarketplace("langwatch/agent-plugin-fork");
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().marketplaceOwnedByLangwatch).toBe(false);
    });

    it("disclaims an owner that merely ends in our name", async () => {
      seedMarketplace("evil-langwatch/agent-plugin");
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().marketplaceOwnedByLangwatch).toBe(false);
    });

    /** @scenario "A marketplace that only mentions our repository is not ours" */
    it("disclaims a source that only mentions us outside its identifying fields", async () => {
      writeJson(["plugins", "known_marketplaces.json"], {
        langwatch: {
          source: {
            source: "github",
            repo: "somebody-else/their-plugins",
            description: "a fork of langwatch/agent-plugin",
            commit: "sync with langwatch/agent-plugin",
          },
        },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().marketplaceOwnedByLangwatch).toBe(false);
    });
  });

  describe("given the plugin switched on in the settings file", () => {
    it("reports it enabled", async () => {
      writeJson(["settings.json"], {
        enabledPlugins: { "langwatch@langwatch": true },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().enabled).toBe(true);
    });

    it("reports it disabled when the flag is false", async () => {
      writeJson(["settings.json"], {
        enabledPlugins: { "langwatch@langwatch": false },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().enabled).toBe(false);
    });
  });
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
      writeJson(["settings.json"], {
        model: "claude-sonnet-5",
        hooks: {
          SessionStart: [
            userEntry,
            {
              hooks: [
                {
                  type: "command",
                  command: "langwatch ingest hook claude-code",
                  timeout: 10,
                },
              ],
            },
          ],
        },
      });

      const { ensureLangwatchClaudePlugin } = await loadModule();
      ensureLangwatchClaudePlugin({ interactive: true });

      const after = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as {
        hooks: Record<string, unknown[]>;
        model: string;
      };
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
      writeJson(["settings.json"], {
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: "langwatch ingest hook claude-code" },
              ],
            },
          ],
        },
      });

      const { ensureLangwatchClaudePlugin } = await loadModule();
      ensureLangwatchClaudePlugin({ interactive: true });

      expect(fs.readFileSync(settingsPath(), "utf8")).not.toContain(
        "langwatch ingest hook",
      );
    });
  });

  describe("given a claude binary with no plugin subcommand", () => {
    /** @scenario "A claude without plugin support falls back to the raw hook entries" */
    it("reports the plugin unavailable and attempts no install", async () => {
      claudeWhere({ pluginHelp: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true }).action).toBe(
        "unavailable",
      );
      expect(commandsRun()).toEqual(["plugin --help"]);
    });

    it("records no failure, so the next run probes again", async () => {
      claudeWhere({ pluginHelp: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();
      ensureLangwatchClaudePlugin({ interactive: true });

      expect(readConfig().claude_plugin_last_failure).toBeUndefined();
    });
  });

  describe("given a marketplace add that reports failure", () => {
    /** @scenario "A marketplace that is already registered survives a failing add" */
    it("installs anyway when the marketplace is registered afterwards", async () => {
      seedMarketplace();
      claudeWhere({ marketplaceAdd: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true })).toEqual({
        action: "installed",
      });
      expect(commandsRun()).toContain(
        "plugin install langwatch@langwatch --scope user",
      );
    });

    it("gives up when the marketplace is still unknown afterwards", async () => {
      claudeWhere({ marketplaceAdd: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      const result = ensureLangwatchClaudePlugin({ interactive: true });
      expect(result.action).toBe("failed");
      expect(commandsRun()).not.toContain(
        "plugin install langwatch@langwatch --scope user",
      );
    });
  });

  describe("given a plugin install that fails", () => {
    /** @scenario "A failed plugin install falls back to the raw hook entries" */
    it("reports failure with a reason so the caller can fall back", async () => {
      claudeWhere({ install: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      const result = ensureLangwatchClaudePlugin({ interactive: true });
      expect(result.action).toBe("failed");
      expect(result.reason).toContain("install rejected");
    });

    it("stamps the failure on the config", async () => {
      claudeWhere({ install: 1 });
      const { ensureLangwatchClaudePlugin } = await loadModule();
      ensureLangwatchClaudePlugin({ interactive: true });

      expect(readConfig().claude_plugin_last_failure).toBeTypeOf("number");
    });

    it("returns rather than throwing when the subprocess throws", async () => {
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
        if (args.join(" ") === "plugin --help") return ok;
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
        claude_plugin_last_failure:
          Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60,
      });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true }).action).toBe(
        "installed",
      );
      expect(commandsRun()).toContain(
        "plugin install langwatch@langwatch --scope user",
      );
      expect(readConfig().claude_plugin_last_failure).toBeUndefined();
    });
  });

  describe("given a failure stamped in the future", () => {
    /** @scenario "A failure recorded ahead of this machine's clock suppresses nothing" */
    it("attempts the install rather than waiting for the clock to catch up", async () => {
      writeConfig({
        claude_plugin_last_failure:
          Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      });
      const { ensureLangwatchClaudePlugin } = await loadModule();

      expect(ensureLangwatchClaudePlugin({ interactive: true }).action).toBe(
        "installed",
      );
    });
  });
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
      writeJson(["settings.json"], {
        model: "claude-sonnet-5",
        enabledPlugins: { "langwatch@langwatch": true, "other@theirs": true },
      });
      claudeWhere({ uninstall: 1 });
      const { uninstallLangwatchClaudePlugin } = await loadModule();

      expect(uninstallLangwatchClaudePlugin()).toEqual({ action: "disabled" });

      const after = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as {
        model: string;
        enabledPlugins: Record<string, boolean>;
      };
      expect(after.enabledPlugins["langwatch@langwatch"]).toBe(false);
      expect(after.enabledPlugins["other@theirs"]).toBe(true);
      expect(after.model).toBe("claude-sonnet-5");
    });

    /** @scenario "A logout that finds the plugin already switched off reports it removed" */
    it("reports the plugin disabled when a previous logout already switched it off", async () => {
      seedInstalledPlugin();
      writeJson(["settings.json"], {
        enabledPlugins: { "langwatch@langwatch": false },
      });
      claudeWhere({ uninstall: 1 });
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
      seedMarketplace("somebody-else/their-plugins");
      const { removeLangwatchClaudeMarketplace } = await loadModule();

      expect(removeLangwatchClaudeMarketplace()).toBe(false);
      expect(commandsRun()).toEqual([]);
    });
  });
});
