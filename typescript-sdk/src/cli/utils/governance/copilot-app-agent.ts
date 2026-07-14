/**
 * Imperative install/remove of the Copilot app login agent (ADR-039
 * §Extension). The pure descriptor + env live in `copilot-app.ts`; this
 * module writes that descriptor to disk and registers/unregisters it with
 * the OS service manager (launchd / systemd --user / Task Scheduler).
 *
 * fs and the OS register command are injected so the orchestration is
 * unit-testable without touching the machine; the default wiring shells
 * out for real.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  COPILOT_APP_AGENT_LABEL,
  renderLaunchAgent,
  type AppPlatform,
  type LaunchAgentSpec,
} from "./copilot-app";

export interface AgentIo {
  mkdirp: (dir: string) => void;
  writeFile: (file: string, content: string, mode: number) => void;
  removeFile: (file: string) => void;
  fileExists: (file: string) => boolean;
  /** Register/unregister with the OS service manager. */
  run: (cmd: string, args: string[]) => void;
}

const defaultIo: AgentIo = {
  mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
  writeFile: (file, content, mode) => fs.writeFileSync(file, content, { mode }),
  removeFile: (file) => {
    try {
      fs.rmSync(file);
    } catch {
      /* already gone */
    }
  },
  fileExists: (file) => fs.existsSync(file),
  run: (cmd, args) => {
    execFileSync(cmd, args, { stdio: "ignore" });
  },
};

/** The file registered with the OS service manager (no side effects). */
export function copilotAppAgentPath(
  platform: AppPlatform,
  home: string,
): string {
  return renderLaunchAgent({ platform, home, execPath: "", env: {} })
    .registerPath;
}

/** Every file the agent writes on this platform — for cleanup. Paths are
 * env-independent, so an empty-env render yields the full set. */
function copilotAppAgentFiles(platform: AppPlatform, home: string): string[] {
  return renderLaunchAgent({ platform, home, execPath: "", env: {} }).files.map(
    (f) => f.path,
  );
}

/** Whether the agent descriptor is already on disk. */
export function isCopilotAppAgentInstalled(
  platform: AppPlatform,
  home: string,
  io: Pick<AgentIo, "fileExists"> = defaultIo,
): boolean {
  return io.fileExists(copilotAppAgentPath(platform, home));
}

/** The OS commands that register the descriptor, per platform. */
function registerCommands(
  platform: AppPlatform,
  descriptorPath: string,
): { cmd: string; args: string[] }[] {
  switch (platform) {
    case "darwin":
      return [
        // unload first so re-connect re-points idempotently
        { cmd: "launchctl", args: ["unload", descriptorPath] },
        { cmd: "launchctl", args: ["load", descriptorPath] },
      ];
    case "linux":
      return [
        { cmd: "systemctl", args: ["--user", "daemon-reload"] },
        {
          cmd: "systemctl",
          args: [
            "--user",
            "enable",
            "--now",
            `${COPILOT_APP_AGENT_LABEL}.service`,
          ],
        },
      ];
    case "win32":
      return [
        {
          cmd: "schtasks",
          args: ["/Create", "/TN", COPILOT_APP_AGENT_LABEL, "/XML", descriptorPath, "/F"],
        },
      ];
  }
}

/** The OS commands that unregister the agent, per platform. */
function unregisterCommands(
  platform: AppPlatform,
): { cmd: string; args: string[] }[] {
  switch (platform) {
    case "darwin":
      return []; // launchctl unload handled with the descriptor path below
    case "linux":
      return [
        {
          cmd: "systemctl",
          args: [
            "--user",
            "disable",
            "--now",
            `${COPILOT_APP_AGENT_LABEL}.service`,
          ],
        },
      ];
    case "win32":
      return [
        { cmd: "schtasks", args: ["/Delete", "/TN", COPILOT_APP_AGENT_LABEL, "/F"] },
      ];
  }
}

/**
 * Install (or re-point) the login agent: write the descriptor and
 * register it with the OS. Idempotent — re-running overwrites the
 * descriptor and re-registers, never stacking a second agent (one label,
 * one file).
 */
export function installCopilotAppAgent(
  spec: LaunchAgentSpec,
  io: AgentIo = defaultIo,
): string {
  const descriptor = renderLaunchAgent(spec);
  for (const file of descriptor.files) {
    io.mkdirp(path.dirname(file.path));
    io.writeFile(file.path, file.content, file.mode);
  }
  for (const { cmd, args } of registerCommands(
    spec.platform,
    descriptor.registerPath,
  )) {
    try {
      io.run(cmd, args);
    } catch {
      // unload-before-load fails on first install (nothing loaded yet);
      // other failures are surfaced by the caller's confirm step.
    }
  }
  return descriptor.registerPath;
}

/**
 * Remove the login agent: unregister from the OS and delete the
 * descriptor. Safe to call when nothing is installed (idempotent).
 * Returns true when a descriptor was present and removed.
 */
export function removeCopilotAppAgent(
  platform: AppPlatform,
  home: string,
  io: AgentIo = defaultIo,
): boolean {
  const registerPath = copilotAppAgentPath(platform, home);
  const present = io.fileExists(registerPath);

  if (platform === "darwin") {
    try {
      io.run("launchctl", ["unload", registerPath]);
    } catch {
      /* not loaded */
    }
  }
  for (const { cmd, args } of unregisterCommands(platform)) {
    try {
      io.run(cmd, args);
    } catch {
      /* not registered */
    }
  }
  // Delete every file the agent wrote (descriptor + any launch wrapper).
  for (const file of copilotAppAgentFiles(platform, home)) {
    io.removeFile(file);
  }
  return present;
}
