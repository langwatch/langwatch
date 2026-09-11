/**
 * `installTelemetryWiring` INSTALLS the persistent per-tool wiring on a
 * machine that may have none (the refresh functions in telemetry-refresh
 * only re-sync wiring that is already there). Real fs, sandboxed HOME.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appSettingsTargetFor } from "../app-settings";
import { installTelemetryWiring } from "../instrument-wiring";
import { runningCodeRestartNotice } from "../running-code";
import {
	baseCfg,
	installTempHomeAndCwd,
} from "./telemetry-refresh-test-helpers";

const temp = installTempHomeAndCwd();

vi.mock("../running-code", () => ({ runningCodeRestartNotice: vi.fn() }));

const ENDPOINT = "http://app.example.com/api/otel";
const TOKEN = "ik-lw-wiring0000000000_secret";

let origShell: string | undefined;

beforeEach(() => {
  origShell = process.env.SHELL;
  process.env.SHELL = "/bin/zsh";
});

afterEach(() => {
  if (origShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = origShell;
});

describe("installTelemetryWiring", () => {
  describe("when langwatch code is running", () => {
    const notice =
      "Restart `langwatch code` to apply the updated telemetry settings.";
    const install = (token = TOKEN) =>
      installTelemetryWiring({
        cfg: baseCfg(),
        tool: "code",
        endpoint: ENDPOINT,
        token,
      });

    beforeEach(() => {
      vi.mocked(runningCodeRestartNotice).mockReturnValue(notice);
    });

    /** @scenario "A running langwatch code command needs a restart after reconfiguration" */
    it("reports restart advice after changing the ingest key", () => {
      install();
      expect(install("ik-lw-replacement_secret").warnings).toContain(notice);
    });

    it("reports restart advice after changing the endpoint", () => {
      install();
      const result = installTelemetryWiring({
        cfg: baseCfg(),
        tool: "code",
        endpoint: "https://new.example.com/api/otel",
        token: TOKEN,
      });
      expect(result.warnings).toContain(notice);
    });

    it("stays quiet when no LangWatch code launcher is detected", () => {
      install();
      vi.mocked(runningCodeRestartNotice).mockReturnValue(undefined);
      expect(install("ik-lw-replacement_secret").warnings).toEqual([]);
    });

    /** @scenario "Unchanged wiring needs no restart notice" */
    it("does not inspect processes or advise restarting unchanged wiring", () => {
      install();
      vi.mocked(runningCodeRestartNotice).mockClear();
      expect(install().warnings).toEqual([]);
      expect(runningCodeRestartNotice).not.toHaveBeenCalled();
    });

    it("does not report a restart when the wiring write fails", () => {
      fs.mkdirSync(path.join(temp.home, ".zshrc"));
      expect(install().warnings).not.toContain(notice);
    });

    it.skipIf(process.platform === "win32")(
      "does not report a restart when VS Code's companion write fails",
      () => {
        const settingsParent =
          process.platform === "darwin"
            ? path.join(
                temp.home,
                "Library",
                "Application Support",
                "Code",
                "User",
              )
            : path.join(temp.home, ".config", "Code", "User");
        fs.mkdirSync(path.join(settingsParent, "settings.json"), {
          recursive: true,
        });
        const result = install();
        expect(result.requiredFailures).not.toEqual([]);
        expect(result.warnings).not.toContain(notice);
      },
    );
  });
  describe("when the tool is claude", () => {
    /** @scenario "The wiring targets are the same files a wrapped run manages" */
    it("writes the OTel env into the user settings.json on a fresh machine", () => {
      const result = installTelemetryWiring({
        cfg: baseCfg(),
        tool: "claude",
        endpoint: ENDPOINT,
        token: TOKEN,
      });

      expect(result.warnings).toEqual([]);
      expect(result.labels).toHaveLength(1);
      const target = appSettingsTargetFor("claude")!;
      const written = JSON.parse(fs.readFileSync(target.path, "utf8")) as {
        env: Record<string, string>;
      };
      expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(ENDPOINT);
      expect(written.env.OTEL_EXPORTER_OTLP_HEADERS).toContain(TOKEN);
    });
  });

  describe("when the tool is codex", () => {
    it("writes the [otel] block with the Authorization header inline", () => {
      const result = installTelemetryWiring({
        cfg: baseCfg(),
        tool: "codex",
        endpoint: ENDPOINT,
        token: TOKEN,
      });

      expect(result.warnings).toEqual([]);
      expect(result.labels).toHaveLength(1);
      const toml = fs.readFileSync(path.join(temp.home, ".codex", "config.toml"), "utf8");
      // codex's exporter posts to the endpoint verbatim, so the trace
      // suffix is spelled out; the header makes a plain `codex` capture.
      expect(toml).toContain(`${ENDPOINT}/v1/traces`);
      expect(toml).toContain(`Bearer ${TOKEN}`);
    });
  });

  describe("when the tool persists as a scoped shell function (gemini)", () => {
    it("writes the marker-managed function into the shell rc", () => {
      const result = installTelemetryWiring({
        cfg: baseCfg(),
        tool: "gemini",
        endpoint: ENDPOINT,
        token: TOKEN,
      });

      expect(result.warnings).toEqual([]);
      const rc = fs.readFileSync(path.join(temp.home, ".zshrc"), "utf8");
      expect(rc).toContain("gemini()");
      expect(rc).toContain(ENDPOINT);
      expect(rc).toContain(TOKEN);
    });
  });

  describe("when the login shell is unrecognized", () => {
    it("falls back to the platform default rc instead of giving up", () => {
      // A headless VPS whose SHELL is /bin/sh (or tcsh) still gets wired:
      // zsh on macOS, bash on linux. `instrument` exists for exactly
      // these machines.
      process.env.SHELL = "/bin/tcsh";

      const result = installTelemetryWiring({
        cfg: baseCfg(),
        tool: "gemini",
        endpoint: ENDPOINT,
        token: TOKEN,
      });

      expect(result.warnings).toEqual([]);
      expect(result.labels).toHaveLength(1);
      const rcName = process.platform === "darwin" ? ".zshrc" : ".bashrc";
      const rc = fs.readFileSync(path.join(temp.home, rcName), "utf8");
      expect(rc).toContain(TOKEN);
    });
  });
});
