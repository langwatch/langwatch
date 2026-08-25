/**
 * The logout scan surface: `scanTelemetryTargets()` must find every place
 * `langwatch <tool>` persisted telemetry wiring and remove exactly those
 * regions. Exercised against a real temp HOME with each target seeded the
 * same way the install path writes it.
 */

import type * as ChildProcessModule from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { writeCodexGatewayBlock, writeCodexOtelBlock } from "../../codex-config-toml";
import {
  appSettingsTargetFor,
  claudeProjectSettingsTarget,
  installAppEnv,
} from "../app-settings";
import {
  installOpencodeSessionContextPlugin,
  OPENCODE_PLUGIN_FILE_NAME,
  opencodePluginTarget,
} from "../opencode-plugin";
import { telemetryEnvVarNames } from "../otel-env-block";
import {
  installSessionContextHooks,
  sessionContextHookCommand,
} from "../session-context-hooks";
import { buildScopedToolFunction, persistBlockToRc, toolMarkers } from "../shell-rc";
import { scanTelemetryTargets } from "../telemetry-targets";
import {
  OWNED_MARKETPLACE_REPO,
  seedInstalledPlugin,
  seedMarketplace as seedMarketplaceFixture,
  writeClaudeJson as writeClaudeJsonFixture,
} from "./claude-plugin-test-helpers";

// The plugin targets shell out to `claude`, and no test may reach a real one.
// This claude supports plugins and succeeds by default; a scenario that needs a
// subcommand to fail overrides that one subcommand and leaves `plugin --help`
// answering, because whether the subcommand exists is probed once per process.
const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof ChildProcessModule>("node:child_process");
  return { ...actual, spawnSync: spawnSyncMock };
});

let tmpHome: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origCodexHome = process.env.CODEX_HOME;
const origXdgConfigHome = process.env.XDG_CONFIG_HOME;

// The directory the scan treats as "this directory". A scratch one by
// default: the targets a scan returns can REMOVE real files, and a suite that
// let that resolve to the checkout it runs in would delete the project pin of
// any developer who had run `langwatch claude` there.
let scanCwd: string;

const scan = () => scanTelemetryTargets({ cwd: scanCwd });

const presentLabels = (): string[] =>
  scan()
    .filter((t) => t.present)
    .map((t) => t.label);

const claudeCommandsRun = (): string[] =>
  spawnSyncMock.mock.calls.map((call: unknown[]) => (call[1] as string[]).join(" "));

/** Write a plugin state file under the temp home's claude directory. */
const writeClaudeJson = ({
  segments,
  value,
}: {
  segments: string[];
  value: unknown;
}): void => writeClaudeJsonFixture({ home: tmpHome, segments, value });

const seedLangwatchPlugin = (): void => seedInstalledPlugin({ home: tmpHome });

const seedMarketplace = (repo = OWNED_MARKETPLACE_REPO): void =>
  seedMarketplaceFixture({ home: tmpHome, repo });

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-telemetry-targets-"));
  scanCwd = path.join(tmpHome, "cwd");
  fs.mkdirSync(scanCwd, { recursive: true });
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  spawnSyncMock.mockReset();
  spawnSyncMock.mockReturnValue({ status: 0, stdout: "", stderr: "" });
  // codex resolves its home from CODEX_HOME first; keep it unset so it
  // falls back to ~/.codex under the temp HOME. opencode reads
  // XDG_CONFIG_HOME the same way, for ~/.config/opencode.
  delete process.env.CODEX_HOME;
  delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserprofile;
  if (origCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = origCodexHome;
  if (origXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = origXdgConfigHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("scanTelemetryTargets", () => {
  describe("when nothing is installed", () => {
    it("reports no present targets", () => {
      expect(presentLabels()).toEqual([]);
    });
  });

  describe("when claude, codex, and a shell function are installed", () => {
    beforeEach(() => {
      // claude → settings.json env
      const claude = appSettingsTargetFor("claude")!;
      installAppEnv(claude, {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel",
        CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      });
      // codex → [otel] block in config.toml
      writeCodexOtelBlock(
        {
          baseEndpoint: "http://app/api/otel",
          ingestionToken: "sk-lw-SECRET",
        },
        { persistAuthHeader: true },
      );
      // gemini → scoped shell function in ~/.zshrc
      persistBlockToRc(
        "zsh",
        buildScopedToolFunction(
          "gemini",
          { OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel" },
          "zsh",
        ),
        toolMarkers("gemini"),
      );
    });

    it("reports the claude, codex, and gemini targets as present", () => {
      const labels = presentLabels();
      expect(labels.some((l) => l.startsWith("claude telemetry env"))).toBe(true);
      expect(labels.some((l) => l.startsWith("codex [otel] block"))).toBe(true);
      expect(labels.some((l) => l.startsWith("gemini shell function"))).toBe(true);
    });

    it("removes every present target, and a re-scan finds nothing", () => {
      for (const t of scan().filter((t) => t.present)) {
        expect(t.remove()).toBe(true);
      }
      expect(presentLabels()).toEqual([]);
    });

    it("strips the claude OTEL keys from settings.json but keeps user keys", () => {
      const claude = appSettingsTargetFor("claude")!;
      // seed a user key alongside
      const settings = JSON.parse(fs.readFileSync(claude.path, "utf8"));
      settings.env.MY_OWN = "keep";
      settings.model = "claude-sonnet-5";
      fs.writeFileSync(claude.path, JSON.stringify(settings, null, 2));

      for (const t of scan().filter((t) => t.present)) {
        t.remove();
      }

      const after = JSON.parse(fs.readFileSync(claude.path, "utf8"));
      expect(after.env).toEqual({ MY_OWN: "keep" });
      expect(after.model).toBe("claude-sonnet-5");
    });
  });

  describe("when a scoped code() function is installed (VS Code)", () => {
    beforeEach(() => {
      persistBlockToRc(
        "zsh",
        buildScopedToolFunction(
          "code",
          {
            COPILOT_OTEL_ENABLED: "true",
            OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel",
          },
          "zsh",
        ),
        toolMarkers("code"),
      );
    });

    /** @scenario Logout removes the scoped code() function */
    it("reports the code function target and removes it on logout, leaving the rc clean", () => {
      expect(presentLabels().some((l) => l.startsWith("code shell function"))).toBe(true);

      for (const t of scan().filter((t) => t.present)) {
        expect(t.remove()).toBe(true);
      }

      expect(presentLabels()).toEqual([]);
    });
  });

  describe("when settings.json carries the langwatch hooks and a user's own", () => {
    const userEntry = {
      hooks: [{ type: "command", command: "./scripts/session-log.sh" }],
    };

    /** @scenario "Logout removes exactly the LangWatch hook entries" */
    it("removes the langwatch entries and leaves the user's hook", () => {
      const claude = appSettingsTargetFor("claude")!;
      fs.mkdirSync(path.dirname(claude.path), { recursive: true });
      fs.writeFileSync(
        claude.path,
        JSON.stringify({ hooks: { SessionStart: [userEntry] } }, null, 2),
      );
      installSessionContextHooks({ tool: "claude_code" });

      expect(presentLabels().some((l) => l.startsWith("claude session hooks"))).toBe(
        true,
      );

      for (const t of scan().filter((t) => t.present)) {
        expect(t.remove()).toBe(true);
      }

      const after = JSON.parse(fs.readFileSync(claude.path, "utf8"));
      expect(after.hooks).toEqual({ SessionStart: [userEntry] });
      expect(JSON.stringify(after)).not.toContain(
        sessionContextHookCommand("claude_code"),
      );
      expect(presentLabels()).toEqual([]);
    });
  });

  describe("when the codex hooks and the opencode plugin are installed", () => {
    /** @scenario "Logout removes the codex hooks and the opencode plugin" */
    it("reports both, then removes both", () => {
      installSessionContextHooks({ tool: "codex" });
      installOpencodeSessionContextPlugin();

      const labels = presentLabels();
      expect(labels.some((l) => l.startsWith("codex session hooks"))).toBe(true);
      expect(labels.some((l) => l.startsWith("opencode session plugin"))).toBe(true);

      for (const t of scan().filter((t) => t.present)) {
        expect(t.remove()).toBe(true);
      }

      expect(presentLabels()).toEqual([]);
      expect(fs.existsSync(opencodePluginTarget().path)).toBe(false);
    });

    /** @scenario "A plugin file LangWatch did not write is never removed" */
    it("leaves a plugin of the same name somebody else wrote", () => {
      const target = opencodePluginTarget();
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(target.path, "export const Mine = async () => ({});\n");

      expect(presentLabels().some((l) => l.startsWith("opencode session plugin"))).toBe(
        false,
      );

      for (const t of scan()) t.remove();

      expect(fs.readFileSync(target.path, "utf8")).toBe(
        "export const Mine = async () => ({});\n",
      );
      expect(path.basename(target.path)).toBe(OPENCODE_PLUGIN_FILE_NAME);
    });
  });

  describe("when the langwatch claude plugin is installed from our marketplace", () => {
    beforeEach(() => {
      seedLangwatchPlugin();
      seedMarketplace();
    });

    /** @scenario "Logout lists the installed plugin and the LangWatch marketplace" */
    it("reports the plugin and the marketplace as present", () => {
      const labels = presentLabels();
      expect(labels).toContain("claude langwatch plugin (langwatch@langwatch)");
      expect(labels).toContain("claude langwatch plugin marketplace (langwatch)");
    });

    /** @scenario "Logout uninstalls the plugin and removes the marketplace" */
    it("uninstalls the plugin at user scope and removes the marketplace", () => {
      for (const t of scan().filter((t) => t.present)) {
        expect(t.remove()).toBe(true);
      }

      expect(claudeCommandsRun()).toContain(
        "plugin uninstall langwatch@langwatch --scope user",
      );
      expect(claudeCommandsRun()).toContain("plugin marketplace remove langwatch");
    });
  });

  describe("when the plugin is enabled but the uninstall subcommand fails", () => {
    /** @scenario "A plugin the uninstall subcommand cannot remove is disabled instead" */
    it("switches the plugin off in the settings file instead", () => {
      seedLangwatchPlugin();
      writeClaudeJson({
        segments: ["settings.json"],
        value: {
          model: "claude-sonnet-5",
          enabledPlugins: { "langwatch@langwatch": true },
        },
      });
      spawnSyncMock.mockImplementation((_bin: string, args: string[]) =>
        args.join(" ").startsWith("plugin uninstall")
          ? { status: 1, stdout: "", stderr: "no" }
          : { status: 0, stdout: "", stderr: "" },
      );

      const target = scan().find((t) => t.label.startsWith("claude langwatch plugin ("))!;
      expect(target.present).toBe(true);
      expect(target.remove()).toBe(true);

      const settings = JSON.parse(
        fs.readFileSync(path.join(tmpHome, ".claude", "settings.json"), "utf8"),
      ) as { model: string; enabledPlugins: Record<string, boolean> };
      expect(settings.enabledPlugins["langwatch@langwatch"]).toBe(false);
      expect(settings.model).toBe("claude-sonnet-5");
    });
  });

  describe("when a marketplace of our name points at somebody else's repository", () => {
    /** @scenario "A marketplace LangWatch did not register is left alone" */
    it("does not report it, and remove() runs no claude subprocess", () => {
      seedMarketplace("somebody-else/their-plugins");

      expect(
        presentLabels().some((l) => l.startsWith("claude langwatch plugin marketplace")),
      ).toBe(false);

      const target = scan().find((t) =>
        t.label.startsWith("claude langwatch plugin marketplace"),
      )!;
      expect(target.remove()).toBe(false);
      expect(claudeCommandsRun()).toEqual([]);
    });
  });

  describe("when the codex gateway (Path A) profile is installed", () => {
    it("reports the gateway block and profile file, then removes both", () => {
      writeCodexGatewayBlock({ gatewayUrl: "https://gateway.langwatch.ai" });
      const labels = presentLabels();
      expect(labels.some((l) => l.startsWith("codex gateway block"))).toBe(true);
      expect(labels.some((l) => l.startsWith("codex langwatch profile file"))).toBe(true);

      for (const t of scan().filter((t) => t.present)) {
        t.remove();
      }
      expect(presentLabels()).toEqual([]);
    });
  });

  describe("when the working directory carries a claude project pin", () => {
    beforeEach(() => {
      scanCwd = path.join(tmpHome, "project");
      fs.mkdirSync(scanCwd, { recursive: true });
      installAppEnv(claudeProjectSettingsTarget(scanCwd), {
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer ik-lw-x_y",
        CLAUDE_CODE_ENABLE_TELEMETRY: "1",
      });
    });

    it("reports the pin as present and removes it on logout", () => {
      expect(
        presentLabels().some((l) => l.startsWith("claude project telemetry pin")),
      ).toBe(true);

      for (const t of scan().filter((t) => t.present)) {
        expect(t.remove()).toBe(true);
      }

      expect(
        fs.existsSync(path.join(tmpHome, "project", ".claude", "settings.local.json")),
      ).toBe(false);
      expect(presentLabels()).toEqual([]);
    });
  });

  describe("when settings.json carries the user's own OTLP wiring under the same key names", () => {
    it("does not report the claude target as present, and remove() leaves it untouched", () => {
      // OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS are
      // standard OpenTelemetry env var names — a user could plausibly
      // point them at a collector of their own (Honeycomb here) under
      // the exact same keys langwatch writes. Presence of the NAMES is
      // not ownership; the scan must not offer this for removal.
      const claude = appSettingsTargetFor("claude")!;
      installAppEnv(claude, {
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
        OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=abc",
      });
      const before = fs.readFileSync(claude.path, "utf8");

      expect(presentLabels().some((l) => l.startsWith("claude telemetry env"))).toBe(
        false,
      );

      const target = scan().find((t) => t.label.startsWith("claude telemetry env"))!;
      expect(target.remove()).toBe(false);
      expect(fs.readFileSync(claude.path, "utf8")).toBe(before);
    });
  });

  describe("when the project pin directory carries the user's own OTLP wiring", () => {
    let cwdSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      const projectDir = path.join(tmpHome, "project");
      fs.mkdirSync(projectDir, { recursive: true });
      cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir) as ReturnType<
        typeof vi.spyOn
      >;
      installAppEnv(claudeProjectSettingsTarget(projectDir), {
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
      });
    });

    afterEach(() => {
      cwdSpy.mockRestore();
    });

    it("does not report the project pin as present, and remove() leaves it untouched", () => {
      const pinPath = path.join(tmpHome, "project", ".claude", "settings.local.json");
      const before = fs.readFileSync(pinPath, "utf8");

      expect(
        presentLabels().some((l) => l.startsWith("claude project telemetry pin")),
      ).toBe(false);

      const target = scan().find((t) =>
        t.label.startsWith("claude project telemetry pin"),
      )!;
      expect(target.remove()).toBe(false);
      expect(fs.readFileSync(pinPath, "utf8")).toBe(before);
    });
  });

  describe("when an unrelated file happens to live at the codex profile path", () => {
    it("does not report the codex profile target as present, and remove() leaves it untouched", () => {
      // The path name (~/.codex/langwatch-gateway.config.toml) is
      // distinctive but not proof of ownership on its own.
      const profilePath = path.join(tmpHome, ".codex", "langwatch-gateway.config.toml");
      fs.mkdirSync(path.dirname(profilePath), { recursive: true });
      fs.writeFileSync(profilePath, "# a file the user put here themselves\n");

      expect(
        presentLabels().some((l) => l.startsWith("codex langwatch profile file")),
      ).toBe(false);

      const target = scan().find((t) =>
        t.label.startsWith("codex langwatch profile file"),
      )!;
      expect(target.remove()).toBe(false);
      expect(fs.existsSync(profilePath)).toBe(true);
    });
  });

  describe("when a block lives in ~/.zshrc but $SHELL is bash", () => {
    it("still finds it — the scan sweeps all shells", () => {
      const prevShell = process.env.SHELL;
      process.env.SHELL = "/bin/bash";
      try {
        persistBlockToRc(
          "zsh",
          buildScopedToolFunction(
            "opencode",
            { OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel" },
            "zsh",
          ),
          toolMarkers("opencode"),
        );
        expect(presentLabels().some((l) => l.startsWith("opencode shell function"))).toBe(
          true,
        );
      } finally {
        if (prevShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = prevShell;
      }
    });
  });

  it("uses the same key set the install path writes (no drift)", () => {
    // guard the app-settings removal against the claude key list drifting
    // from buildOtelEnvBlock: the removal keys ARE telemetryEnvVarNames.
    const keys = telemetryEnvVarNames("claude");
    expect(keys).toContain("OTEL_EXPORTER_OTLP_ENDPOINT");
    expect(keys).toContain("CLAUDE_CODE_ENABLE_TELEMETRY");
  });
});
