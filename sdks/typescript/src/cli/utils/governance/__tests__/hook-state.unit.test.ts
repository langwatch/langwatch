/**
 * Where the session-context hook keeps its fingerprints.
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultStateDir, stateFilePath, writeFingerprint } from "../hook-state";

let tmpDir: string;
const origConfig = process.env.LANGWATCH_CLI_CONFIG;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-hook-state-"));
});

afterEach(() => {
  if (origConfig === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
  else process.env.LANGWATCH_CLI_CONFIG = origConfig;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("defaultStateDir()", () => {
  describe("given LANGWATCH_CLI_CONFIG names a config outside the home directory", () => {
    /** @scenario "An isolated CLI config keeps its own session fingerprints" */
    it("keeps the fingerprint beside that config, not under the home directory", () => {
      const isolated = path.join(tmpDir, "isolated");
      process.env.LANGWATCH_CLI_CONFIG = path.join(isolated, "config.json");

      const stateDir = defaultStateDir();
      // Asserted before writing, so a regression never writes into the real home.
      expect(stateDir).toBe(path.join(isolated, "state", "session-context"));

      const stateFile = stateFilePath({ stateDir, agent: "copilot", sessionId: "s1" });
      writeFingerprint({ stateFile, fingerprint: "fp", now: () => 0 });
      expect(fs.existsSync(stateFile)).toBe(true);
    });
  });

  describe("given no override", () => {
    it("stays under ~/.langwatch", () => {
      delete process.env.LANGWATCH_CLI_CONFIG;
      expect(defaultStateDir()).toBe(
        path.join(os.homedir(), ".langwatch", "state", "session-context"),
      );
    });
  });
});
