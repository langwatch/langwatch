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

interface OsCommand {
  cmd: string;
  args: string[];
  /** When true, a non-zero exit is expected and tolerated (e.g. the
   * first-install `launchctl unload` when nothing is loaded yet). All
   * other commands must succeed or the install/remove is a failure. */
  tolerateFailure?: boolean;
}

/** The OS commands that register the descriptor, per platform. */
function registerCommands(
  platform: AppPlatform,
  descriptorPath: string,
): OsCommand[] {
  switch (platform) {
    case "darwin":
      return [
        // unload first so re-connect re-points idempotently; on a first
        // install nothing is loaded yet, so this one failure is expected.
        {
          cmd: "launchctl",
          args: ["unload", descriptorPath],
          tolerateFailure: true,
        },
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

/** The OS commands that unregister the agent, per platform. Every command
 * must succeed for the agent to be considered stopped. */
function unregisterCommands(
  platform: AppPlatform,
  descriptorPath: string,
): OsCommand[] {
  switch (platform) {
    case "darwin":
      // Stop + unload the running agent. If this fails the launchd job may
      // still be alive and exporting, so it is NOT tolerated on removal.
      return [{ cmd: "launchctl", args: ["unload", descriptorPath] }];
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
export class CopilotAppAgentError extends Error {
  constructor(
    readonly op: "register" | "unregister",
    readonly command: string,
    cause: unknown,
  ) {
    super(
      `Copilot app capture agent ${op} failed at \`${command}\`: ${
        (cause as Error)?.message ?? String(cause)
      }`,
    );
    this.name = "CopilotAppAgentError";
  }
}

export function installCopilotAppAgent(
  spec: LaunchAgentSpec,
  io: AgentIo = defaultIo,
): string {
  const descriptor = renderLaunchAgent(spec);
  for (const file of descriptor.files) {
    io.mkdirp(path.dirname(file.path));
    io.writeFile(file.path, file.content, file.mode);
  }
  for (const { cmd, args, tolerateFailure } of registerCommands(
    spec.platform,
    descriptor.registerPath,
  )) {
    try {
      io.run(cmd, args);
    } catch (err) {
      // Only the expected first-install `launchctl unload` is tolerated.
      // Every other service-manager failure means the agent is NOT
      // registered — surface it so the caller never reports a mint +
      // "connected" while capture is actually off.
      if (!tolerateFailure) {
        throw new CopilotAppAgentError("register", `${cmd} ${args.join(" ")}`, err);
      }
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
  if (!io.fileExists(registerPath)) return false; // nothing installed

  // Stop + unregister first. If any command fails, the agent may still be
  // loaded and exporting content; do NOT delete the descriptor (that would
  // remove the retry path) and do NOT report success — surface the failure
  // so `logout` prints it as "couldn't remove" rather than a clean removal.
  for (const { cmd, args } of unregisterCommands(platform, registerPath)) {
    try {
      io.run(cmd, args);
    } catch (err) {
      throw new CopilotAppAgentError("unregister", `${cmd} ${args.join(" ")}`, err);
    }
  }

  // Unregister succeeded — the agent is stopped, so it is safe to delete
  // every file it wrote (descriptor + any launch wrapper).
  for (const file of copilotAppAgentFiles(platform, home)) {
    io.removeFile(file);
  }
  return true;
}
