/**
 * What the LangWatch Claude Code plugin seam reads off disk, and what it makes
 * of a `claude` binary that may or may not understand plugins at all.
 *
 * `node:child_process` is the only thing mocked. Every file the module reads is
 * a real file under a temp HOME, so the state parsing is exercised against the
 * shapes Claude Code actually writes.
 *
 * Feature: specs/ai-governance/cli-wrappers/claude-plugin-install.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";

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
  loadModule,
  pluginsDir,
  seedInstalledPlugin,
  seedMarketplace,
  writeJson,
} = installClaudePluginHarness({
  spawnSyncMock,
  prefix: "lw-claude-plugin-state-",
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
      answerClaude({ pluginHelp: 1 });
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
      fs.writeFileSync(path.join(pluginsDir(), "installed_plugins.json"), "{ not json");
      fs.writeFileSync(path.join(pluginsDir(), "known_marketplaces.json"), "[[[");
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
      writeJson({
        segments: ["plugins", "installed_plugins.json"],
        value: { version: 2, plugins: { "langwatch@langwatch": [] } },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().pluginInstalled).toBe(false);
    });

    it("ignores install records belonging to other plugins", async () => {
      writeJson({
        segments: ["plugins", "installed_plugins.json"],
        value: {
          version: 2,
          plugins: { "somebody-else@theirs": [{ scope: "user" }] },
        },
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
      writeJson({
        segments: ["plugins", "known_marketplaces.json"],
        value: {
          langwatch: {
            source: {
              source: "git",
              url: "https://github.com/langwatch/agent-plugin.git",
            },
          },
        },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().marketplaceOwnedByLangwatch).toBe(true);
    });

    it("disclaims a same-named marketplace pointing somewhere else", async () => {
      seedMarketplace({ repo: "somebody-else/their-plugins" });
      const { readClaudePluginState } = await loadModule();
      const state = readClaudePluginState();
      expect(state.marketplaceKnown).toBe(true);
      expect(state.marketplaceOwnedByLangwatch).toBe(false);
    });

    it("disclaims a repository that merely extends our name", async () => {
      seedMarketplace({ repo: "langwatch/agent-plugin-fork" });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().marketplaceOwnedByLangwatch).toBe(false);
    });

    it("disclaims an owner that merely ends in our name", async () => {
      seedMarketplace({ repo: "evil-langwatch/agent-plugin" });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().marketplaceOwnedByLangwatch).toBe(false);
    });

    /** @scenario "A source built to read like ours is not ours" */
    it("disclaims the addresses built to read like our repository", async () => {
      // Each of these contains our repository name and belongs to somebody
      // else. Ownership decides what logout may deregister and what a wrapped
      // run may pull new plugin code from, so a lookalike that passes here
      // gets both.
      const lookalikes = [
        "https://github.com/langwatch/agent-plugin.evil",
        "https://evil.example/?repo=langwatch/agent-plugin",
        "https://evil.example/langwatch/agent-plugin",
        "https://github.com.evil.example/langwatch/agent-plugin",
        "https://github.com/langwatch/agent-plugin#/../evil",
        "/home/someone/checkouts/langwatch/agent-plugin",
        "file:///home/someone/checkouts/langwatch/agent-plugin",
        "git@evil.example:langwatch/agent-plugin.git",
      ];

      for (const url of lookalikes) {
        writeJson({
          segments: ["plugins", "known_marketplaces.json"],
          value: { langwatch: { source: { source: "git", url } } },
        });
        const { readClaudePluginState } = await loadModule();
        expect(
          readClaudePluginState().marketplaceOwnedByLangwatch,
          `${url} must not read as ours`,
        ).toBe(false);
      }
    });

    it("claims ownership of the canonical addresses of our repository", async () => {
      const ours = [
        "https://github.com/langwatch/agent-plugin",
        "https://github.com/langwatch/agent-plugin.git",
        "https://GitHub.com/LangWatch/Agent-Plugin.git",
        "git@github.com:langwatch/agent-plugin.git",
      ];

      for (const url of ours) {
        writeJson({
          segments: ["plugins", "known_marketplaces.json"],
          value: { langwatch: { source: { source: "git", url } } },
        });
        const { readClaudePluginState } = await loadModule();
        expect(readClaudePluginState().marketplaceOwnedByLangwatch, `${url} is ours`).toBe(true);
      }
    });

    /** @scenario "A marketplace that only mentions our repository is not ours" */
    it("disclaims a source that only mentions us outside its identifying fields", async () => {
      writeJson({
        segments: ["plugins", "known_marketplaces.json"],
        value: {
          langwatch: {
            source: {
              source: "github",
              repo: "somebody-else/their-plugins",
              description: "a fork of langwatch/agent-plugin",
              commit: "sync with langwatch/agent-plugin",
            },
          },
        },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().marketplaceOwnedByLangwatch).toBe(false);
    });
  });

  describe("given the plugin switched on in the settings file", () => {
    it("reports it enabled", async () => {
      writeJson({
        segments: ["settings.json"],
        value: { enabledPlugins: { "langwatch@langwatch": true } },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().enabled).toBe(true);
    });

    it("reports it disabled when the flag is false", async () => {
      writeJson({
        segments: ["settings.json"],
        value: { enabledPlugins: { "langwatch@langwatch": false } },
      });
      const { readClaudePluginState } = await loadModule();
      expect(readClaudePluginState().enabled).toBe(false);
    });
  });
});
