/**
 * The `langwatch claude` persist offer, once the Claude Code plugin carries the
 * session context hooks.
 *
 * Two paths run through the same function and must behave very differently. The
 * run where the user just answered "yes" may install the plugin, because there
 * is somebody at the terminal to answer a trust prompt. Every later run only
 * re-verifies an already-configured device, and must touch neither the network
 * nor a subprocess.
 *
 * readline, `node:child_process` and saveConfig are mocked; the settings file
 * and the plugin state files are real files under a temp HOME.
 *
 * Feature: specs/ai-governance/cli-wrappers/claude-plugin-install.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GovernanceConfig } from "../config";
import type * as ConfigModule from "../config";
import {
  seedInstalledPlugin as seedInstalledPluginFixture,
  writeClaudeJson,
} from "./claude-plugin-test-helpers";

const answers: string[] = [];
const lastPrompts: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (a: string) => void) => {
      lastPrompts.push(q);
      cb(answers.shift() ?? "");
    },
    close: () => undefined,
  }),
}));

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));

const saveConfigMock = vi.fn();
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof ConfigModule>("../config");
  return { ...actual, saveConfig: saveConfigMock };
});

let tmpHome: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origShell = process.env.SHELL;
const origConfig = process.env.LANGWATCH_CLI_CONFIG;
const origTtyDescriptor = Object.getOwnPropertyDescriptor(
  process.stdin,
  "isTTY",
);
const origEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const otelVars: Record<string, string> = {
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://app.example.com/api/otel",
  OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer sk-lw-token",
};

const ok = { status: 0, stdout: "", stderr: "" };

const cfg = (overrides: Partial<GovernanceConfig> = {}): GovernanceConfig => ({
  gateway_url: "http://gw.example.com",
  control_plane_url: "http://app.example.com",
  ...overrides,
});

const settingsPath = (): string =>
  path.join(tmpHome, ".claude", "settings.json");

const writeJson = ({
  segments,
  value,
}: {
  segments: string[];
  value: unknown;
}): void => writeClaudeJson({ home: tmpHome, segments, value });

const seedInstalledPlugin = (): void =>
  seedInstalledPluginFixture({ home: tmpHome });

const rawHookEntry = {
  hooks: [
    { type: "command", command: "langwatch ingest hook claude-code", timeout: 10 },
  ],
};

const readSettings = (): Record<string, any> =>
  JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Record<string, any>;

const rawHooksPresent = (): boolean =>
  fs.existsSync(settingsPath()) &&
  fs.readFileSync(settingsPath(), "utf8").includes("langwatch ingest hook");

const commandsRun = (): string[] =>
  spawnSyncMock.mock.calls.map((call: unknown[]) =>
    (call[1] as string[]).join(" "),
  );

/** Runs the offer against a fresh module graph, so the CLI probe runs once. */
const runOffer = async (
  config: GovernanceConfig = cfg(),
): Promise<void> => {
  vi.resetModules();
  const { maybeOfferIngestionShellRcPersist } = await import("../shell-rc.js");
  await maybeOfferIngestionShellRcPersist({
    cfg: config,
    tool: "claude",
    vars: otelVars,
  });
};

/** A claude that supports plugins and succeeds at everything asked of it. */
const claudeWithPlugins = (): void => {
  spawnSyncMock.mockReturnValue(ok);
};

/** A claude old enough to have no `plugin` subcommand at all. */
const claudeWithoutPlugins = (): void => {
  spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "unknown" });
};

/** A claude that takes the subcommand but cannot complete the install. */
const claudeWithFailingInstall = (): void => {
  spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
    const joined = args.join(" ");
    if (joined.startsWith("plugin install")) {
      return { status: 1, stdout: "", stderr: "install rejected" };
    }
    return ok;
  });
};

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-claude-persist-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.SHELL = "/bin/zsh";
  process.env.LANGWATCH_CLI_CONFIG = path.join(tmpHome, "config.json");
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  answers.length = 0;
  lastPrompts.length = 0;
  saveConfigMock.mockReset();
  spawnSyncMock.mockReset();
  claudeWithPlugins();
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserprofile;
  if (origShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = origShell;
  if (origConfig === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
  else process.env.LANGWATCH_CLI_CONFIG = origConfig;
  if (origEndpoint === undefined) {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  } else {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = origEndpoint;
  }
  // A non-TTY runner has no own `isTTY` descriptor to put back, so restoring
  // only when there was one leaves this suite's forced `true` on process.stdin
  // for every file that runs after it in the same worker.
  if (origTtyDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", origTtyDescriptor);
  } else {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the claude persist offer", () => {
  describe("when the user consents and claude supports plugins", () => {
    beforeEach(() => answers.push("y"));

    it("installs the plugin instead of writing raw hook entries", async () => {
      await runOffer();

      expect(commandsRun()).toContain(
        "plugin install langwatch@langwatch --scope user",
      );
      expect(readSettings().hooks).toBeUndefined();
      expect(rawHooksPresent()).toBe(false);
    });

    it("still persists the telemetry env block, which no plugin can set", async () => {
      await runOffer();

      expect(readSettings().env).toEqual(otelVars);
    });

    /** @scenario "Installing the plugin removes the raw hook entries it replaces" */
    it("clears raw hook entries a previous CLI left behind", async () => {
      writeJson({
        segments: ["settings.json"],
        value: { hooks: { SessionStart: [rawHookEntry] } },
      });

      await runOffer();

      expect(rawHooksPresent()).toBe(false);
    });
  });

  describe("when the user consents and claude has no plugin subcommand", () => {
    beforeEach(() => {
      claudeWithoutPlugins();
      answers.push("y");
    });

    /** @scenario "A claude without plugin support falls back to the raw hook entries" */
    it("writes the raw hook entries and attempts no install", async () => {
      await runOffer();

      expect(Object.keys(readSettings().hooks)).toEqual([
        "SessionStart",
        "Stop",
      ]);
      expect(commandsRun()).toEqual(["plugin --help"]);
    });
  });

  describe("when the user consents and the plugin install fails", () => {
    beforeEach(() => {
      claudeWithFailingInstall();
      answers.push("y");
    });

    /** @scenario "A failed plugin install falls back to the raw hook entries" */
    it("falls back to the raw hook entries", async () => {
      await runOffer();

      expect(Object.keys(readSettings().hooks)).toEqual([
        "SessionStart",
        "Stop",
      ]);
    });

    /** @scenario "A failed plugin install never fails the session it was offered in" */
    it("completes without throwing and still persists the env block", async () => {
      await expect(runOffer()).resolves.toBeUndefined();

      expect(readSettings().env).toEqual(otelVars);
    });
  });

  describe("when a plugin install failed an hour ago", () => {
    /** @scenario "A failed plugin install is not retried for a day" */
    it("writes the raw hook entries without attempting the install", async () => {
      fs.writeFileSync(
        process.env.LANGWATCH_CLI_CONFIG!,
        JSON.stringify({
          ...cfg(),
          claude_plugin_last_failure: Math.floor(Date.now() / 1000) - 3600,
        }),
      );
      answers.push("y");

      await runOffer();

      expect(commandsRun()).toEqual([]);
      expect(Object.keys(readSettings().hooks)).toEqual([
        "SessionStart",
        "Stop",
      ]);
    });
  });

  describe("when the offer is shown for claude", () => {
    /** @scenario "The consent prompt names the plugin and what its hooks record" */
    it("names the plugin and what its session hooks record", async () => {
      answers.push("y");

      await runOffer();

      expect(lastPrompts).toHaveLength(1);
      expect(lastPrompts[0]).toContain("LangWatch Claude Code plugin");
      expect(lastPrompts[0]).toContain("repository and branch");
      expect(lastPrompts[0]).toContain("~/.claude/settings.json");
    });
  });
});

describe("the silent re-assert of an already-configured device", () => {
  beforeEach(() => {
    // The env block is already current, which is what sends the offer down the
    // re-assert path instead of prompting.
    writeJson({ segments: ["settings.json"], value: { env: otelVars } });
  });

  describe("when the plugin is already installed", () => {
    /** @scenario "The silent re-assert installs nothing when the plugin is already there" */
    it("runs no claude subprocess and writes no raw hook entries", async () => {
      seedInstalledPlugin();

      await runOffer();

      expect(commandsRun()).toEqual([]);
      expect(lastPrompts).toHaveLength(0);
      expect(rawHooksPresent()).toBe(false);
    });

    /** @scenario "The silent re-assert removes raw hook entries the plugin replaced" */
    it("clears raw hook entries the plugin replaced", async () => {
      seedInstalledPlugin();
      writeJson({
        segments: ["settings.json"],
        value: {
          env: otelVars,
          hooks: { SessionStart: [rawHookEntry], Stop: [rawHookEntry] },
        },
      });

      await runOffer();

      expect(rawHooksPresent()).toBe(false);
      expect(readSettings().env).toEqual(otelVars);
      expect(commandsRun()).toEqual([]);
    });

    it("leaves the user's own hook entries alone", async () => {
      seedInstalledPlugin();
      const userEntry = {
        hooks: [{ type: "command", command: "./scripts/mine.sh" }],
      };
      writeJson({
        segments: ["settings.json"],
        value: {
          env: otelVars,
          hooks: { SessionStart: [userEntry, rawHookEntry] },
        },
      });

      await runOffer();

      expect(readSettings().hooks).toEqual({ SessionStart: [userEntry] });
    });
  });

  describe("when no plugin is installed", () => {
    /** @scenario "The silent re-assert falls back to the raw hooks without the plugin" */
    it("asserts the raw hook entries without running a claude subprocess", async () => {
      await runOffer();

      expect(Object.keys(readSettings().hooks)).toEqual([
        "SessionStart",
        "Stop",
      ]);
      expect(commandsRun()).toEqual([]);
      expect(lastPrompts).toHaveLength(0);
    });
  });
});
