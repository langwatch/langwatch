import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import chalk from "chalk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { homePath, terminalRenderer } from "../src/animation/log-tee.ts";
import { runningLine } from "../src/animation/open-browser.ts";
import { execAndPipe } from "../src/services/_pipe-to-bus.ts";
import { EventBus } from "../src/services/event-bus.ts";
import {
  clickhouseLogLevel,
  postgresLogLevel,
  pythonLogLevel,
  redisLogLevel,
  resolveLogSettings,
} from "../src/shared/log-level.ts";
import type { RuntimeEvent } from "../src/shared/runtime-contract.ts";

// Colourless, so the assertions read the text a person sees.
chalk.level = 0;

function renderAll({
  events,
  showsServiceOutput,
}: {
  events: RuntimeEvent[];
  showsServiceOutput: boolean;
}): string[] {
  const render = terminalRenderer({ showsServiceOutput });
  return events.flatMap((ev) => {
    const line = render(ev);
    return line === null ? [] : [line];
  });
}

const log = (service: string, line: string): RuntimeEvent => ({
  type: "log",
  service,
  stream: "stdout",
  line,
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lw-terminal-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("the log level services start at", () => {
  describe("when neither LOG_LEVEL nor --verbose is given", () => {
    /** @scenario "Services log at warn by default" */
    it("is warn, in the form each service reads", () => {
      const { level, showsServiceOutput } = resolveLogSettings({ env: {}, isVerbose: false });

      expect(level).toBe("warn");
      expect(showsServiceOutput).toBe(false);
      expect(clickhouseLogLevel(level)).toBe("warning");
      expect(postgresLogLevel(level)).toBe("warning");
      expect(redisLogLevel(level)).toBe("warning");
      expect(pythonLogLevel(level)).toBe("WARN");
    });
  });

  describe("when an install step runs", () => {
    /** @scenario "Services log at warn by default" */
    it("writes its output to its own file in the logs directory", async () => {
      const logsDir = join(home, "logs");
      const bus = new EventBus();

      await execAndPipe({
        bus,
        service: "prepare:langevals",
        bin: process.execPath,
        args: ["-e", "console.log('Resolved 212 packages'); console.error('Installed 3')"],
        logsDir,
      });

      const file = join(logsDir, "prepare:langevals.log");
      await expect
        .poll(() => readFileSync(file, "utf8"))
        .toBe("Resolved 212 packages\nInstalled 3\n");
    });
  });

  describe("when --verbose is passed", () => {
    /** @scenario "Verbose shows everything" */
    it("is info, and the terminal shows every service's output", () => {
      expect(resolveLogSettings({ env: {}, isVerbose: true })).toEqual({
        level: "info",
        showsServiceOutput: true,
      });
    });
  });

  describe("when LOG_LEVEL is set", () => {
    /** @scenario "LOG_LEVEL sets the level for every service" */
    it("is that level for every service, and the terminal shows their output", () => {
      const settings = resolveLogSettings({ env: { LOG_LEVEL: "DEBUG" }, isVerbose: false });

      expect(settings).toEqual({ level: "debug", showsServiceOutput: true });
      expect(clickhouseLogLevel(settings.level)).toBe("debug");
      expect(postgresLogLevel(settings.level)).toBe("debug1");
      expect(pythonLogLevel(settings.level)).toBe("DEBUG");
    });
  });
});

describe("the terminal", () => {
  describe("when services start at the default level", () => {
    /** @scenario "The terminal shows progress and status, not service output" */
    it("shows each service starting and healthy, and none of its output", () => {
      const lines = renderAll({
        showsServiceOutput: false,
        events: [
          { type: "starting", service: "postgres" },
          log("postgres", "LOG:  database system is ready to accept connections"),
          log("langwatch", '{"level":"info","msg":"listening","port":5576}'),
          { type: "healthy", service: "postgres", durationMs: 812 },
        ],
      });

      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^⋯ postgres\s+starting/);
      expect(lines[1]).toMatch(/^✓ postgres\s+healthy in 812ms/);
    });
  });

  describe("when the backend logs an error", () => {
    /** @scenario "An error from the backend shows as one readable line" */
    it("shows one line with the service, the message and the error's message", () => {
      const record = JSON.stringify({
        level: "error",
        msg: "could not send the alert",
        error: { message: "connect ECONNREFUSED 127.0.0.1:587" },
        service: "langwatch-api",
      });
      const pinoRecord = JSON.stringify({ level: 50, msg: "job failed" });

      const lines = renderAll({
        showsServiceOutput: false,
        events: [log("langwatch", record), log("langwatch", pinoRecord)],
      });

      expect(lines).toEqual([
        expect.stringMatching(
          /^✗ langwatch\s+could not send the alert: connect ECONNREFUSED 127\.0\.0\.1:587$/,
        ),
        expect.stringMatching(/^✗ langwatch\s+job failed$/),
      ]);
      expect(lines.join("\n")).not.toContain("{");
    });
  });

  describe("when a service crashes", () => {
    /** @scenario "A crash shows the end of that service's log" */
    it("shows the crash, its log file's path and the last 20 lines of its log", () => {
      const output = Array.from({ length: 25 }, (_, index) => log("langevals", `line ${index}`));

      const lines = renderAll({
        showsServiceOutput: false,
        events: [...output, { type: "crashed", service: "langevals", code: 1 }],
      });
      const report = lines.join("\n").split("\n");

      expect(report[0]).toMatch(/^✗ langevals\s+crashed \(code 1\), see .*langevals\.log$/);
      expect(report.slice(1)).toEqual(
        Array.from({ length: 20 }, (_, index) => `  │ line ${index + 5}`),
      );
    });
  });

  describe("when an install step runs at the default level", () => {
    /** @scenario "Install output shows as progress only" */
    it("shows the step starting and finishing, not the installer's package list", () => {
      const lines = renderAll({
        showsServiceOutput: false,
        events: [
          { type: "starting", service: "prepare:langevals" },
          log("prepare:langevals", "Resolved 212 packages in 1.2s"),
          log("prepare:langevals", " + litellm==1.74.0"),
          { type: "healthy", service: "prepare:langevals", durationMs: 4100 },
        ],
      });

      expect(lines).toHaveLength(2);
      expect(lines.join("\n")).not.toContain("litellm");
    });
  });

  describe("when the run is verbose", () => {
    /** @scenario "Verbose shows everything" */
    it("shows every line of every service, prefixed with its name", () => {
      const lines = renderAll({
        showsServiceOutput: true,
        events: [log("postgres", "LOG:  checkpoint starting"), log("go", "INF serving")],
      });

      expect(lines).toEqual([
        expect.stringMatching(/^│ postgres\s+LOG: {2}checkpoint starting$/),
        expect.stringMatching(/^│ go\s+INF serving$/),
      ]);
    });
  });

  describe("when the app is ready", () => {
    /** @scenario "The running line says where the logs are" */
    it("says where it runs, where the logs are and how to stop it", () => {
      const line = runningLine({ url: "http://localhost:5560", logsDir: join(home, "logs") });

      expect(line).toContain("langwatch is running at http://localhost:5560");
      expect(line).toContain(`logs in ${homePath(join(home, "logs"))}`);
      expect(line).toContain("Ctrl+C to stop");
    });
  });
});
