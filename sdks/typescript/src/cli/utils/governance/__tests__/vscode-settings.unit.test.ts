/**
 * Unit tests for the VS Code integrated-terminal telemetry hardening
 * (ADR-039 §Extension #2). Uses a tmp home + explicit platform so no real
 * machine settings are touched.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildOtelEnvBlock } from "../otel-env-block";
import {
  clearVscodeTerminalOtelEnv,
  removeVscodeTerminalOtelEnv,
  vscodeTerminalEnvHasAnyClear,
  vscodeUserSettingsPath,
  VSCODE_TELEMETRY_ENV_KEYS,
  type VscodePlatform,
} from "../vscode-settings";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "lw-vscode-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const KEYS = [...VSCODE_TELEMETRY_ENV_KEYS];

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

describe("vscodeUserSettingsPath()", () => {
  it.each([
    ["darwin", "Library/Application Support/Code/User/settings.json"],
    ["linux", ".config/Code/User/settings.json"],
    ["win32", "AppData/Roaming/Code/User/settings.json"],
  ] as [VscodePlatform, string][])(
    "resolves the User settings.json for %s",
    (platform, tail) => {
      const p = vscodeUserSettingsPath(platform, home);
      expect(p).toContain(tail.replace(/\//g, path.sep));
    },
  );

  it("returns null for an unsupported platform", () => {
    expect(vscodeUserSettingsPath("aix" as VscodePlatform, home)).toBeNull();
  });
});

describe("clearVscodeTerminalOtelEnv()", () => {
  describe("when settings.json does not exist yet", () => {
    /** @scenario Setting up code clears the telemetry env from VS Code integrated terminals */
    it("creates it with every telemetry key nulled under the terminal env", () => {
      const p = clearVscodeTerminalOtelEnv({ platform: "darwin", home, keys: KEYS });

      expect(p).not.toBeNull();
      const s = readJson(p!);
      const env = s["terminal.integrated.env.osx"] as Record<string, unknown>;
      for (const k of KEYS) expect(env[k]).toBeNull();
    });
  });

  describe("when settings.json already has user content", () => {
    it("preserves every other user setting verbatim", () => {
      const p = vscodeUserSettingsPath("linux", home)!;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(
        p,
        JSON.stringify({
          "editor.fontSize": 14,
          "terminal.integrated.env.linux": { MY_OWN: "keep" },
        }),
      );

      clearVscodeTerminalOtelEnv({ platform: "linux", home, keys: KEYS });

      const s = readJson(p);
      expect(s["editor.fontSize"]).toBe(14);
      const env = s["terminal.integrated.env.linux"] as Record<string, unknown>;
      expect(env.MY_OWN).toBe("keep");
      expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBeNull();
    });
  });

  describe("when settings.json is JSONC (VS Code's actual format)", () => {
    it("preserves comments, trailing commas, and every user key", () => {
      // VS Code ships a comment-only settings.json out of the box and
      // preserves user comments — JSON.parse-based editing destroyed all
      // of it (the P0 this pins).
      const p = vscodeUserSettingsPath("darwin", home)!;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(
        p,
        `{
  // Editor
  "editor.fontSize": 14,
  "editor.fontFamily": "Berkeley Mono",
  "terminal.integrated.env.osx": { "MY_OWN": "keep-me" },
}
`,
      );

      const written = clearVscodeTerminalOtelEnv({
        platform: "darwin",
        home,
        keys: KEYS,
      });

      expect(written).toBe(p);
      const text = fs.readFileSync(p, "utf8");
      expect(text).toContain("// Editor");
      expect(text).toContain('"editor.fontFamily": "Berkeley Mono"');
      expect(text).toContain('"MY_OWN": "keep-me"');
      expect(text).toContain('"OTEL_EXPORTER_OTLP_HEADERS": null');
    });

    it("handles VS Code's default comment-only file without destroying it", () => {
      const p = vscodeUserSettingsPath("darwin", home)!;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "{\n  // Place your settings here\n}\n");

      const written = clearVscodeTerminalOtelEnv({
        platform: "darwin",
        home,
        keys: KEYS,
      });

      expect(written).toBe(p);
      const text = fs.readFileSync(p, "utf8");
      expect(text).toContain("// Place your settings here");
      expect(text).toContain('"COPILOT_OTEL_ENABLED": null');
    });

    it("refuses to write a file that does not parse even as JSONC", () => {
      const p = vscodeUserSettingsPath("darwin", home)!;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const broken = '{ "editor.fontSize": 14, "unterminated": "';
      fs.writeFileSync(p, broken);

      const written = clearVscodeTerminalOtelEnv({
        platform: "darwin",
        home,
        keys: KEYS,
      });

      expect(written).toBeNull();
      expect(fs.readFileSync(p, "utf8")).toBe(broken); // untouched
    });
  });

  it("is a no-op (returns null) on an unsupported platform", () => {
    expect(
      clearVscodeTerminalOtelEnv({
        platform: "aix" as VscodePlatform,
        home,
        keys: KEYS,
      }),
    ).toBeNull();
  });

  it("is a no-op when there are no keys to clear", () => {
    expect(
      clearVscodeTerminalOtelEnv({ platform: "darwin", home, keys: [] }),
    ).toBeNull();
  });
});

describe("removeVscodeTerminalOtelEnv()", () => {
  describe("given a settings.json with the cleared keys installed", () => {
    it("removes only our keys and drops the now-empty env object", () => {
      const p = clearVscodeTerminalOtelEnv({ platform: "darwin", home, keys: KEYS })!;

      const changed = removeVscodeTerminalOtelEnv({ platform: "darwin", home, keys: KEYS });

      expect(changed).toBe(true);
      const s = readJson(p);
      expect("terminal.integrated.env.osx" in s).toBe(false);
    });

    it("keeps the user's own terminal env vars and other settings", () => {
      const p = vscodeUserSettingsPath("darwin", home)!;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ "editor.tabSize": 2 }));
      clearVscodeTerminalOtelEnv({ platform: "darwin", home, keys: KEYS });
      // user adds their own terminal var alongside ours
      const s0 = readJson(p);
      (s0["terminal.integrated.env.osx"] as Record<string, unknown>).MY_OWN = "keep";
      fs.writeFileSync(p, JSON.stringify(s0));

      removeVscodeTerminalOtelEnv({ platform: "darwin", home, keys: KEYS });

      const s = readJson(p);
      expect(s["editor.tabSize"]).toBe(2);
      expect(
        (s["terminal.integrated.env.osx"] as Record<string, unknown>).MY_OWN,
      ).toBe("keep");
    });
  });

  it("returns false when settings.json is absent (idempotent)", () => {
    expect(
      removeVscodeTerminalOtelEnv({ platform: "darwin", home, keys: KEYS }),
    ).toBe(false);
  });

  it("leaves a malformed settings.json untouched", () => {
    const p = vscodeUserSettingsPath("darwin", home)!;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "{ not valid json ");

    expect(
      removeVscodeTerminalOtelEnv({ platform: "darwin", home, keys: KEYS }),
    ).toBe(false);
    expect(fs.readFileSync(p, "utf8")).toBe("{ not valid json ");
  });
});

describe("vscodeTerminalEnvHasAnyClear()", () => {
  it("reports true after a clear and false before", () => {
    const args = { platform: "linux" as VscodePlatform, home, keys: KEYS };
    expect(vscodeTerminalEnvHasAnyClear(args)).toBe(false);
    clearVscodeTerminalOtelEnv(args);
    expect(vscodeTerminalEnvHasAnyClear(args)).toBe(true);
  });
});

describe("VSCODE_TELEMETRY_ENV_KEYS", () => {
  // Drift guard: the cleared key set must match exactly what the code() env
  // block injects, or terminals would leak a key we forgot to clear.
  it("matches the keys of the code buildOtelEnvBlock exactly", () => {
    const block = buildOtelEnvBlock("code", "http://app/api/otel", "sk-lw-tok");
    expect([...VSCODE_TELEMETRY_ENV_KEYS].sort()).toEqual(
      Object.keys(block).sort(),
    );
  });

  it("includes the bearer-token header key (the sensitive one)", () => {
    expect(VSCODE_TELEMETRY_ENV_KEYS).toContain("OTEL_EXPORTER_OTLP_HEADERS");
  });
});
