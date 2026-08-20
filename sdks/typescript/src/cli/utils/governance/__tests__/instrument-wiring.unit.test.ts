/**
 * `installTelemetryWiring` INSTALLS the persistent per-tool wiring on a
 * machine that may have none (the refresh functions in telemetry-refresh
 * only re-sync wiring that is already there). Real fs, sandboxed HOME.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appSettingsTargetFor } from "../app-settings";
import { installTelemetryWiring } from "../instrument-wiring";
import {
  baseCfg,
  installTempHomeAndCwd,
} from "./telemetry-refresh-test-helpers";

const temp = installTempHomeAndCwd();

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
      const toml = fs.readFileSync(
        path.join(temp.home, ".codex", "config.toml"),
        "utf8",
      );
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
