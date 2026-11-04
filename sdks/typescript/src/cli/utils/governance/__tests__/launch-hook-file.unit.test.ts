/**
 * `langwatch grok` writes Grok's hook file itself: the rc prompt that used to
 * be its only writer is skipped once an OTLP endpoint is already set.
 * @see specs/ai-governance/cli-wrappers/grok-hook-install.feature
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertLaunchHookFile } from "../shell-rc";

const origGrokHome = process.env.GROK_HOME;
let grokHome: string;

beforeEach(() => {
  grokHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-grok-home-"));
  process.env.GROK_HOME = grokHome;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (origGrokHome === undefined) delete process.env.GROK_HOME;
  else process.env.GROK_HOME = origGrokHome;
  fs.rmSync(grokHome, { recursive: true, force: true });
});

describe("assertLaunchHookFile", () => {
  describe("when the wrapper prepares a grok launch", () => {
    /** @scenario Launching through langwatch grok writes LangWatch's own hook file */
    it("writes the LangWatch hook file that runs the grok hook", () => {
      assertLaunchHookFile({ tool: "grok" });

      const written = fs.readFileSync(path.join(grokHome, "hooks", "langwatch.json"), "utf8");
      expect(written).toContain("langwatch ingest hook grok");
    });
  });

  describe("when the hook file is written for a scripted launch", () => {
    /** @scenario Launching through langwatch grok writes LangWatch's own hook file */
    it("says so on stderr, keeping stdout clean for grok's JSON output", () => {
      const stdout = vi.spyOn(console, "log");
      const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

      assertLaunchHookFile({ tool: "grok" });

      expect(stdout).not.toHaveBeenCalled();
      expect(String(stderr.mock.calls[0]?.[0])).toContain("Installed");
    });
  });

  describe("when the hooks folder cannot be written", () => {
    // chmod cannot make a folder read-only on Windows, and root writes through it.
    const isUnwritableUnsupported = process.platform === "win32" || process.getuid?.() === 0;

    it.skipIf(isUnwritableUnsupported)(
      "warns on stderr that sessions lose their repository",
      () => {
        fs.chmodSync(grokHome, 0o500);
        const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

        try {
          assertLaunchHookFile({ tool: "grok" });
        } finally {
          fs.chmodSync(grokHome, 0o700);
        }

        expect(String(stderr.mock.calls[0]?.[0])).toContain("will not report their repository");
      },
    );
  });

  describe("when the wrapper prepares a launch of an agent without a launch-written hook", () => {
    it("writes nothing to the Grok hooks folder", () => {
      assertLaunchHookFile({ tool: "claude" });

      expect(fs.existsSync(path.join(grokHome, "hooks"))).toBe(false);
    });
  });
});
