/**
 * The pi telemetry extension: the marker that makes the file ours, and what
 * the generated module does once pi loads it, driven by pi's own event names.
 * Feature: specs/ai-governance/cli-wrappers/pi-extension-install.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PI_EXTENSION_MARKER, piExtensionSource } from "../pi-extension-source";
import {
  hasPiTelemetryExtension,
  installPiTelemetryExtension,
  PI_EXTENSION_FILE_NAME,
  removePiTelemetryExtension,
} from "../pi-plugin";
import { scanTelemetryTargets } from "../telemetry-targets";

let tmpHome: string;
let extensionDir: string;
let extensionPath: string;
const originalHome = process.env.HOME;
const originalUserprofile = process.env.USERPROFILE;
const originalPiDir = process.env.PI_CODING_AGENT_DIR;

const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-pi-plugin-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.PI_CODING_AGENT_DIR;
  extensionDir = path.join(tmpHome, ".pi", "agent", "extensions");
  extensionPath = path.join(extensionDir, PI_EXTENSION_FILE_NAME);
});

afterEach(() => {
  restore("HOME", originalHome);
  restore("USERPROFILE", originalUserprofile);
  restore("PI_CODING_AGENT_DIR", originalPiDir);
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("installPiTelemetryExtension", () => {
  describe("when pi's extension directory holds no LangWatch extension", () => {
    /** @scenario "The first install writes the extension into pi's extension directory" */
    it("writes the extension under its marker and logout's scan lists it", () => {
      const result = installPiTelemetryExtension({});

      expect(result.action).toBe("created");
      const written = fs.readFileSync(extensionPath, "utf8");
      expect(written.split("\n")[0]).toBe(PI_EXTENSION_MARKER);
      expect(written).toBe(piExtensionSource());
      const target = scanTelemetryTargets({ cwd: tmpHome }).find((t) =>
        t.label.startsWith("pi telemetry"),
      );
      expect(target?.present).toBe(true);
    });

    it("follows PI_CODING_AGENT_DIR when pi was relocated", () => {
      const relocated = path.join(tmpHome, "elsewhere");
      process.env.PI_CODING_AGENT_DIR = relocated;

      installPiTelemetryExtension({});

      expect(fs.existsSync(path.join(relocated, "extensions", PI_EXTENSION_FILE_NAME))).toBe(true);
    });
  });

  describe("when the file at that path is byte for byte what this CLI writes", () => {
    /** @scenario "A second install leaves an unchanged extension alone" */
    it("leaves it as it is and keeps one file, so pi registers one set of handlers", () => {
      installPiTelemetryExtension({});
      const before = fs.statSync(extensionPath).mtimeMs;

      const result = installPiTelemetryExtension({});

      expect(result.action).toBe("unchanged");
      expect(fs.statSync(extensionPath).mtimeMs).toBe(before);
      expect(fs.readdirSync(extensionDir)).toEqual([PI_EXTENSION_FILE_NAME]);
    });
  });

  describe("when the file carries our marker but older contents", () => {
    /** @scenario "An extension left by an older CLI is rewritten" */
    it("rewrites it with this CLI's extension", () => {
      fs.mkdirSync(extensionDir, { recursive: true });
      fs.writeFileSync(extensionPath, `${PI_EXTENSION_MARKER}\n// an older extension\n`);

      const result = installPiTelemetryExtension({});

      expect(result.action).toBe("updated");
      expect(fs.readFileSync(extensionPath, "utf8")).toBe(piExtensionSource());
    });
  });

  describe("when a file at that path carries no LangWatch marker", () => {
    /** @scenario "A file at that path without our marker is never overwritten" */
    it("leaves the file exactly as it is", () => {
      fs.mkdirSync(extensionDir, { recursive: true });
      const theirs = "// somebody else's pi extension\nexport default () => {};\n";
      fs.writeFileSync(extensionPath, theirs);

      installPiTelemetryExtension({});

      expect(fs.readFileSync(extensionPath, "utf8")).toBe(theirs);
      expect(hasPiTelemetryExtension()).toBe(false);
    });
  });
});

describe("removePiTelemetryExtension", () => {
  /** @scenario "Logout removes the extension by its marker" */
  it("removes our extension and leaves an unmarked file in place", () => {
    installPiTelemetryExtension({});
    const target = scanTelemetryTargets({ cwd: tmpHome }).find((t) =>
      t.label.startsWith("pi telemetry"),
    );

    target?.remove();

    expect(fs.existsSync(extensionPath)).toBe(false);
    const theirs = "// not ours\n";
    fs.writeFileSync(extensionPath, theirs);
    expect(removePiTelemetryExtension()).toBe(false);
    expect(fs.readFileSync(extensionPath, "utf8")).toBe(theirs);
  });
});
