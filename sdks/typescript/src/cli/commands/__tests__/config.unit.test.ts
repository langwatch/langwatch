/**
 * `langwatch config set daemon off` — the persistent daemon opt-out — and the
 * per-key validation around it. Driven against a real (temporary) config file
 * via LANGWATCH_CLI_CONFIG, the override the file lookup already honours.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  configGetCommand,
  configListCommand,
  configSetCommand,
} from "../config";
import { loadConfig } from "../../utils/governance/config";

describe("config commands", () => {
  let dir: string;
  let configFile: string;
  let prevConfigEnv: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-config-cmd-"));
    configFile = path.join(dir, "config.json");
    prevConfigEnv = process.env.LANGWATCH_CLI_CONFIG;
    process.env.LANGWATCH_CLI_CONFIG = configFile;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
  });

  afterEach(() => {
    if (prevConfigEnv === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
    else process.env.LANGWATCH_CLI_CONFIG = prevConfigEnv;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("set daemon", () => {
    it("persists the opt-out", async () => {
      await configSetCommand("daemon", "off");

      expect(loadConfig().daemon).toBe("off");
    });

    it("persists on", async () => {
      await configSetCommand("daemon", "on");

      expect(loadConfig().daemon).toBe("on");
    });

    it("rejects anything but on/off, writing nothing", async () => {
      await expect(configSetCommand("daemon", "maybe")).rejects.toThrow(
        "process.exit called",
      );

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(fs.existsSync(configFile)).toBe(false);
    });
  });

  describe("get daemon", () => {
    let writeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      writeSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
    });

    it("defaults to on when nothing was persisted", async () => {
      await configGetCommand("daemon");

      expect(writeSpy).toHaveBeenCalledWith("on\n");
    });

    it("prints the persisted value", async () => {
      await configSetCommand("daemon", "off");
      writeSpy.mockClear();

      await configGetCommand("daemon");

      expect(writeSpy).toHaveBeenCalledWith("off\n");
    });
  });

  describe("list", () => {
    it("shows the daemon setting", async () => {
      await configSetCommand("daemon", "off");
      logSpy.mockClear();

      await configListCommand();

      const out = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(out).toContain("daemon      = off");
    });
  });

  describe("the url keys", () => {
    it("still validate their values as URLs", async () => {
      await expect(configSetCommand("endpoint", "not a url")).rejects.toThrow(
        "process.exit called",
      );

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
