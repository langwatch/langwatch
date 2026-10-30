/**
 * Guards the test-run isolation set up in test-setup.ts: the real tool
 * config dirs must be unset at load, and HOME must drive the settings path
 * once a test points it at a temp dir.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appSettingsTargetFor } from "../app-settings";

const atLoad = {
  claude: process.env.CLAUDE_CONFIG_DIR,
  codex: process.env.CODEX_HOME,
  cli: process.env.LANGWATCH_CLI_CONFIG,
};

const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-env-isolation-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});

afterEach(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  if (origUserprofile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = origUserprofile;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("test run environment isolation", () => {
  describe("given the suite is loaded inside a Claude Code or Codex session", () => {
    it("when the tests start then no tool config dir is inherited", () => {
      expect(atLoad).toEqual({ claude: undefined, codex: undefined, cli: undefined });
    });
  });

  describe("given HOME points at a temp dir", () => {
    it("when the claude settings target is resolved then it lives under that temp home", () => {
      const target = appSettingsTargetFor("claude")!;
      expect(target.path.startsWith(tmpHome)).toBe(true);
    });
  });
});
