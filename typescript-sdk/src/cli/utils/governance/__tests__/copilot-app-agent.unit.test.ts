/**
 * Unit tests for the imperative Copilot app login-agent installer
 * (ADR-039 §Extension) with fs and the OS register command injected —
 * asserts the descriptor is written and the right service-manager command
 * runs, without touching the machine.
 */

import { describe, expect, it } from "vitest";

import {
  installCopilotAppAgent,
  isCopilotAppAgentInstalled,
  removeCopilotAppAgent,
  type AgentIo,
} from "../copilot-app-agent";
import { type LaunchAgentSpec } from "../copilot-app";

function fakeIo(existing = new Set<string>()) {
  const files = new Map<string, string>();
  for (const f of existing) files.set(f, "");
  const runs: { cmd: string; args: string[] }[] = [];
  const io: AgentIo = {
    mkdirp: () => {
      /* no real directories are created in tests */
    },
    writeFile: (file, content, _mode) => void files.set(file, content),
    removeFile: (file) => void files.delete(file),
    fileExists: (file) => files.has(file),
    run: (cmd, args) => void runs.push({ cmd, args }),
  };
  return { io, files, runs };
}

const macSpec: LaunchAgentSpec = {
  platform: "darwin",
  home: "/Users/dev",
  execPath: "/Applications/GitHub Copilot.app/Contents/MacOS/github",
  env: { COPILOT_OTEL_ENABLED: "true" },
};

describe("installCopilotAppAgent", () => {
  describe("when installing on macOS", () => {
    /** @scenario On macOS the agent is a launchd login item */
    it("writes the plist and loads it with launchctl", () => {
      const { io, files, runs } = fakeIo();

      const p = installCopilotAppAgent(macSpec, io);

      expect(p).toContain("Library/LaunchAgents");
      expect(files.get(p)).toContain("<key>RunAtLoad</key>");
      expect(runs.some((r) => r.cmd === "launchctl" && r.args[0] === "load")).toBe(
        true,
      );
    });
  });

  describe("when installing on Linux", () => {
    /** @scenario On Linux the agent is a systemd --user unit */
    it("writes the unit and enables it with systemctl --user", () => {
      const { io, files, runs } = fakeIo();

      const p = installCopilotAppAgent(
        { ...macSpec, platform: "linux", home: "/home/dev" },
        io,
      );

      expect(p).toContain(".config/systemd/user");
      expect(files.get(p)).toContain("ExecStart=");
      expect(
        runs.some(
          (r) => r.cmd === "systemctl" && r.args.includes("enable"),
        ),
      ).toBe(true);
    });
  });

  describe("when installing on Windows", () => {
    /** @scenario On Windows the agent is a Task Scheduler logon task */
    it("writes the task XML plus an env wrapper and registers with schtasks", () => {
      const { io, files, runs } = fakeIo();

      const p = installCopilotAppAgent(
        { ...macSpec, platform: "win32", home: "C:\\Users\\dev" },
        io,
      );

      const xml = files.get(p)!;
      expect(xml).toContain("<LogonTrigger>");
      expect(xml).not.toContain("<Environment>"); // invalid element must be absent
      // the env wrapper is written alongside and referenced by the task
      const wrapperPath = [...files.keys()].find((f) => f.endsWith(".cmd"))!;
      expect(files.get(wrapperPath)).toContain('set "COPILOT_OTEL_ENABLED=true"');
      expect(xml).toContain(".cmd");
      expect(
        runs.some((r) => r.cmd === "schtasks" && r.args.includes("/Create")),
      ).toBe(true);
    });
  });

  describe("when re-running connect", () => {
    /** @scenario Re-running connect never installs a second agent */
    it("overwrites the single descriptor rather than stacking a second", () => {
      const { io, files } = fakeIo();

      const first = installCopilotAppAgent(macSpec, io);
      const second = installCopilotAppAgent(macSpec, io);

      expect(second).toBe(first);
      expect(files.size).toBe(1);
    });
  });
});

describe("removeCopilotAppAgent", () => {
  describe("when the agent is installed", () => {
    /** @scenario Logout removes the capture login agent */
    it("unregisters and deletes the descriptor", () => {
      const { io, files, runs } = fakeIo();
      const p = installCopilotAppAgent(macSpec, io);
      runs.length = 0;

      const removed = removeCopilotAppAgent("darwin", "/Users/dev", io);

      expect(removed).toBe(true);
      expect(files.has(p)).toBe(false);
      expect(
        runs.some((r) => r.cmd === "launchctl" && r.args[0] === "unload"),
      ).toBe(true);
    });
  });

  describe("when nothing is installed", () => {
    it("is a safe no-op", () => {
      const { io } = fakeIo();

      expect(removeCopilotAppAgent("darwin", "/Users/dev", io)).toBe(false);
    });
  });
});

describe("isCopilotAppAgentInstalled", () => {
  it("reports true only when the descriptor is present", () => {
    const { io } = fakeIo();
    expect(isCopilotAppAgentInstalled("darwin", "/Users/dev", io)).toBe(false);

    installCopilotAppAgent(macSpec, io);

    expect(isCopilotAppAgentInstalled("darwin", "/Users/dev", io)).toBe(true);
  });
});
