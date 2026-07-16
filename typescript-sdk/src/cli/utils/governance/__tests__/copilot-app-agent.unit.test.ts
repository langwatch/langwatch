/**
 * Unit tests for the imperative Copilot app login-agent installer
 * (ADR-039 §Extension) with fs and the OS register command injected —
 * asserts the descriptor is written and the right service-manager command
 * runs, without touching the machine.
 */

import { describe, expect, it } from "vitest";

import {
  CopilotAppAgentError,
  installCopilotAppAgent,
  isCopilotAppAgentInstalled,
  removeCopilotAppAgent,
  type AgentIo,
} from "../copilot-app-agent";
import { type LaunchAgentSpec } from "../copilot-app";

/** `failOn(cmd, args)` returns true when that command should throw. */
function fakeIo(
  existing = new Set<string>(),
  failOn: (cmd: string, args: string[]) => boolean = () => false,
) {
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
    run: (cmd, args) => {
      runs.push({ cmd, args });
      if (failOn(cmd, args)) throw new Error(`boom: ${cmd} ${args.join(" ")}`);
    },
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

describe("installCopilotAppAgent registration-failure handling", () => {
  describe("when a real service-manager command fails", () => {
    it("throws instead of reporting a silent success (macOS launchctl load)", () => {
      const { io } = fakeIo(new Set(), (cmd, args) => args[0] === "load");

      expect(() => installCopilotAppAgent(macSpec, io)).toThrow(
        CopilotAppAgentError,
      );
    });

    it("throws when the Windows schtasks /Create fails", () => {
      const { io } = fakeIo(new Set(), (cmd) => cmd === "schtasks");

      expect(() =>
        installCopilotAppAgent(
          { ...macSpec, platform: "win32", home: "C:\\Users\\dev" },
          io,
        ),
      ).toThrow(CopilotAppAgentError);
    });
  });

  describe("when only the expected first-install unload fails", () => {
    it("tolerates it and still installs (load succeeds)", () => {
      // `launchctl unload` errors on a first install (nothing loaded yet);
      // that one failure must not abort the install.
      const { io, files } = fakeIo(new Set(), (cmd, args) => args[0] === "unload");

      const p = installCopilotAppAgent(macSpec, io);

      expect(files.has(p)).toBe(true);
    });
  });
});

describe("removeCopilotAppAgent unregister-failure handling", () => {
  /** @scenario Logout removes the capture login agent */
  it("throws and keeps the descriptor when unregister fails, so a live agent is never silently orphaned", () => {
    // install cleanly, then make the unload fail on removal
    const { io, files } = fakeIo();
    const p = installCopilotAppAgent(macSpec, io);

    const io2 = {
      ...io,
      run: (cmd: string, args: string[]) => {
        if (cmd === "launchctl" && args[0] === "unload") {
          throw new Error("transient unload failure");
        }
      },
    };

    expect(() => removeCopilotAppAgent("darwin", "/Users/dev", io2)).toThrow(
      CopilotAppAgentError,
    );
    // descriptor preserved for retry — NOT deleted
    expect(files.has(p)).toBe(true);
  });
});
