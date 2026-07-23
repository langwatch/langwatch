/**
 * The logout scan surface: `scanTelemetryTargets()` must find every place
 * `langwatch <tool>` persisted telemetry wiring and remove exactly those
 * regions. Exercised against a real temp HOME with each target seeded the
 * same way the install path writes it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  writeCodexGatewayBlock,
  writeCodexOtelBlock,
} from "../../codex-config-toml";
import { appSettingsTargetFor, installAppEnv } from "../app-settings";
import {
  buildScopedToolFunction,
  persistBlockToRc,
  toolMarkers,
} from "../shell-rc";
import { scanTelemetryTargets } from "../telemetry-targets";
import { telemetryEnvVarNames } from "../wrapper-mode";

let tmpHome: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origCodexHome = process.env.CODEX_HOME;

const presentLabels = (): string[] =>
  scanTelemetryTargets()
    .filter((t) => t.present)
    .map((t) => t.label);

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-telemetry-targets-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  // codex resolves its home from CODEX_HOME first; keep it unset so it
  // falls back to ~/.codex under the temp HOME.
  delete process.env.CODEX_HOME;
});

afterEach(() => {
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUserprofile;
  if (origCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = origCodexHome;
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
          endpoint: "http://app/api/otel/v1/traces",
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
      expect(
        labels.some((l) => l.startsWith("gemini shell function")),
      ).toBe(true);
    });

    it("removes every present target, and a re-scan finds nothing", () => {
      for (const t of scanTelemetryTargets().filter((t) => t.present)) {
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

      for (const t of scanTelemetryTargets().filter((t) => t.present)) {
        t.remove();
      }

      const after = JSON.parse(fs.readFileSync(claude.path, "utf8"));
      expect(after.env).toEqual({ MY_OWN: "keep" });
      expect(after.model).toBe("claude-sonnet-5");
    });
  });

  describe("when the codex gateway (Path A) profile is installed", () => {
    it("reports the gateway block and profile file, then removes both", () => {
      writeCodexGatewayBlock({ gatewayUrl: "https://gateway.langwatch.ai" });
      const labels = presentLabels();
      expect(labels.some((l) => l.startsWith("codex gateway block"))).toBe(true);
      expect(
        labels.some((l) => l.startsWith("codex langwatch profile file")),
      ).toBe(true);

      for (const t of scanTelemetryTargets().filter((t) => t.present)) {
        t.remove();
      }
      expect(presentLabels()).toEqual([]);
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
        expect(
          presentLabels().some((l) =>
            l.startsWith("opencode shell function"),
          ),
        ).toBe(true);
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
