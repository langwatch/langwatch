/**
 * The CLI recording where it runs from, for the plugin launcher that cannot
 * resolve it on PATH.
 *
 * Spec: specs/ai-governance/agent-plugin/plugin-package.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { currentCliLocation, recordCliLocation } from "../cli-location";
import { loadConfig, saveConfig } from "../config";

let tmpDir: string;
let savedConfigEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-cli-location-"));
  savedConfigEnv = process.env.LANGWATCH_CLI_CONFIG;
  process.env.LANGWATCH_CLI_CONFIG = path.join(tmpDir, "config.json");
});

afterEach(() => {
  if (savedConfigEnv === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
  else process.env.LANGWATCH_CLI_CONFIG = savedConfigEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const entryScript = (): string => {
  const entry = path.join(tmpDir, "cli", "index.js");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "");
  return entry;
};

describe("the CLI recording its own location", () => {
  describe("given a node binary and an entry script that exist", () => {
    /** @scenario "The CLI records where it runs from" */
    it("writes both absolute paths into the config, and only once for the same location", () => {
      const entry = entryScript();

      expect(
        recordCliLocation({
          location: currentCliLocation({ execPath: process.execPath, entry }),
        }),
      ).toBe(true);
      expect(loadConfig().cli_location).toEqual({
        node: process.execPath,
        entry,
      });

      const before = fs.statSync(process.env.LANGWATCH_CLI_CONFIG!).mtimeMs;
      expect(
        recordCliLocation({
          location: currentCliLocation({ execPath: process.execPath, entry }),
        }),
      ).toBe(false);
      expect(fs.statSync(process.env.LANGWATCH_CLI_CONFIG!).mtimeMs).toBe(before);
    });

    it("resolves a relative entry against the working directory", () => {
      const entry = entryScript();
      const relative = path.relative(process.cwd(), entry);

      expect(currentCliLocation({ execPath: process.execPath, entry: relative })).toEqual({
        node: process.execPath,
        entry,
      });
    });

    it("leaves every other field of the config as it was", () => {
      const cfg = loadConfig();
      cfg.access_token = "token";
      saveConfig(cfg);
      const entry = entryScript();

      recordCliLocation({
        location: { node: process.execPath, entry },
      });

      expect(loadConfig().access_token).toBe("token");
    });

    it("replaces a recorded location that moved", () => {
      const entry = entryScript();
      recordCliLocation({ location: { node: "/old/node", entry: "/old/cli.js" } });

      expect(recordCliLocation({ location: { node: process.execPath, entry } })).toBe(true);
      expect(loadConfig().cli_location).toEqual({ node: process.execPath, entry });
    });
  });

  describe("given an entry script that is not a file on disk", () => {
    it("records nothing", () => {
      expect(
        currentCliLocation({
          execPath: process.execPath,
          entry: path.join(tmpDir, "no-such-entry.js"),
        }),
      ).toBeNull();
      expect(currentCliLocation({ execPath: process.execPath, entry: "" })).toBeNull();
      expect(recordCliLocation({ location: null })).toBe(false);
      expect(fs.existsSync(process.env.LANGWATCH_CLI_CONFIG!)).toBe(false);
    });
  });

  describe("given a config that cannot be written", () => {
    it("reports no write and does not throw", () => {
      process.env.LANGWATCH_CLI_CONFIG = path.join(tmpDir, "not-a-dir", "x", "config.json");
      fs.writeFileSync(path.join(tmpDir, "not-a-dir"), "a file where a directory should be");

      expect(
        recordCliLocation({ location: { node: process.execPath, entry: entryScript() } }),
      ).toBe(false);
    });
  });
});
