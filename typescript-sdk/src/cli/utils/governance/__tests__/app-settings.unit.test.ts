/**
 * Unit tests for the per-tool app-settings persist target — currently
 * only ~/.claude/settings.json for the `claude` wrapper. Covers the
 * three interesting shapes for the merge:
 *   - target file missing entirely (created from scratch)
 *   - target file exists with unrelated user settings (merged, other
 *     top-level keys preserved verbatim)
 *   - target file's env already carries every required key (detected as
 *     installed → no re-prompt)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appEnvHasAllVars,
  appSettingsTargetFor,
  installAppEnv,
} from "../app-settings";

let tmpHome: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;

const otelVars: Record<string, string> = {
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://app.example.com/api/otel",
  OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer sk-lw-token",
};

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-app-settings-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUserprofile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("appSettingsTargetFor", () => {
  describe("when the tool has an app-scoped env block", () => {
    it("returns ~/.claude/settings.json for `claude`", () => {
      const t = appSettingsTargetFor("claude");
      expect(t).not.toBeNull();
      expect(t!.tool).toBe("claude");
      expect(t!.path).toBe(path.join(tmpHome, ".claude", "settings.json"));
      expect(t!.displayPath).toBe("~/.claude/settings.json");
    });
  });

  describe("when the tool has no app-scoped env block", () => {
    it("returns null for `codex`", () => {
      expect(appSettingsTargetFor("codex")).toBeNull();
    });

    it("returns null for `cursor`", () => {
      expect(appSettingsTargetFor("cursor")).toBeNull();
    });

    it("returns null for `gemini`", () => {
      expect(appSettingsTargetFor("gemini")).toBeNull();
    });

    it("returns null for `opencode`", () => {
      expect(appSettingsTargetFor("opencode")).toBeNull();
    });

    it("returns null for an unknown tool", () => {
      expect(appSettingsTargetFor("bogus")).toBeNull();
    });
  });
});

describe("installAppEnv", () => {
  describe("when the settings file does not exist", () => {
    it("creates ~/.claude/settings.json with the OTEL vars under `env`", () => {
      const target = appSettingsTargetFor("claude")!;
      installAppEnv(target, otelVars);

      const written = JSON.parse(fs.readFileSync(target.path, "utf8"));
      expect(written).toEqual({ env: otelVars });
    });

    it("creates the ~/.claude directory when missing", () => {
      const target = appSettingsTargetFor("claude")!;
      expect(fs.existsSync(path.join(tmpHome, ".claude"))).toBe(false);
      installAppEnv(target, otelVars);
      expect(fs.existsSync(path.join(tmpHome, ".claude"))).toBe(true);
    });
  });

  describe("when the settings file already carries user content", () => {
    it("merges vars into `env` and preserves every other top-level key", () => {
      const target = appSettingsTargetFor("claude")!;
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      const userSettings = {
        env: { EXISTING_VAR: "keep-me" },
        permissions: { allow: ["Bash(git status)"] },
        model: "claude-sonnet-5",
      };
      fs.writeFileSync(target.path, JSON.stringify(userSettings, null, 2));

      installAppEnv(target, otelVars);

      const written = JSON.parse(fs.readFileSync(target.path, "utf8"));
      expect(written.env).toEqual({ ...otelVars, EXISTING_VAR: "keep-me" });
      expect(written.permissions).toEqual({ allow: ["Bash(git status)"] });
      expect(written.model).toBe("claude-sonnet-5");
    });

    it("overwrites stale values for keys we own", () => {
      const target = appSettingsTargetFor("claude")!;
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(
        target.path,
        JSON.stringify(
          { env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://stale.example.com" } },
          null,
          2,
        ),
      );

      installAppEnv(target, otelVars);

      const written = JSON.parse(fs.readFileSync(target.path, "utf8"));
      expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
        "http://app.example.com/api/otel",
      );
    });
  });

  describe("when the settings file is malformed JSON", () => {
    it("recovers by replacing the file with a clean env block", () => {
      const target = appSettingsTargetFor("claude")!;
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(target.path, "{not valid json");

      installAppEnv(target, otelVars);

      const written = JSON.parse(fs.readFileSync(target.path, "utf8"));
      expect(written).toEqual({ env: otelVars });
    });
  });
});

describe("appEnvHasAllVars", () => {
  describe("when the file is missing", () => {
    it("returns false", () => {
      const target = appSettingsTargetFor("claude")!;
      expect(appEnvHasAllVars(target, otelVars)).toBe(false);
    });
  });

  describe("when the file has every required key with matching values", () => {
    it("returns true", () => {
      const target = appSettingsTargetFor("claude")!;
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(
        target.path,
        JSON.stringify({ env: { ...otelVars, EXTRA: "ignored" } }, null, 2),
      );
      expect(appEnvHasAllVars(target, otelVars)).toBe(true);
    });
  });

  describe("when the file has one key with a stale value", () => {
    it("returns false", () => {
      const target = appSettingsTargetFor("claude")!;
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(
        target.path,
        JSON.stringify(
          {
            env: {
              ...otelVars,
              OTEL_EXPORTER_OTLP_ENDPOINT: "http://stale.example.com",
            },
          },
          null,
          2,
        ),
      );
      expect(appEnvHasAllVars(target, otelVars)).toBe(false);
    });
  });

  describe("when the file has a subset of the required keys", () => {
    it("returns false", () => {
      const target = appSettingsTargetFor("claude")!;
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(
        target.path,
        JSON.stringify(
          { env: { OTEL_EXPORTER_OTLP_ENDPOINT: otelVars.OTEL_EXPORTER_OTLP_ENDPOINT } },
          null,
          2,
        ),
      );
      expect(appEnvHasAllVars(target, otelVars)).toBe(false);
    });
  });
});
