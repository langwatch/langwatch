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
  type AppPlatform,
  COPILOT_APP_AGENT_LABEL,
  type LaunchAgentSpec,
  renderLaunchAgent,
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
  // Remove first: `writeFileSync`'s `mode` applies only on CREATION — a
  // pre-existing world-readable file at this path would keep its loose
  // permissions and the descriptor carries a bearer token.
  writeFile: (file, content, mode) => {
    fs.rmSync(file, { force: true });
    fs.writeFileSync(file, content, { mode });
  },
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

/**
 * Whether ANY agent file is on disk. Deliberately not just the register
 * descriptor: on win32 the token-bearing `.cmd` wrapper is a separate
 * file, and a partial removal that lost the XML but kept the wrapper must
 * still be listed by logout (and its credential deleted) rather than
 * silently under-reported.
 */
export function isCopilotAppAgentInstalled(
  platform: AppPlatform,
  home: string,
  io: Pick<AgentIo, "fileExists"> = defaultIo,
): boolean {
  return copilotAppAgentFiles(platform, home).some((f) => io.fileExists(f));
}

/** The launchd gui domain target for the current user (darwin only). */
function launchdGuiDomain(): string {
  return `gui/${process.getuid?.() ?? 0}`;
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
        // bootout first so re-connect re-points idempotently; on a first
        // install nothing is loaded yet, so this one failure is expected.
        // `bootstrap`/`bootout` (not legacy `load`/`unload`): the legacy
        // verbs print their failure to stderr and EXIT 0, so a rejected
        // plist would be reported as a successful install with capture
        // silently off — verified against launchd on macOS 15.
        {
          cmd: "launchctl",
          args: ["bootout", `${launchdGuiDomain()}/${COPILOT_APP_AGENT_LABEL}`],
          tolerateFailure: true,
        },
        {
          cmd: "launchctl",
          args: ["bootstrap", launchdGuiDomain(), descriptorPath],
        },
      ];
    case "linux":
      return [
        { cmd: "systemctl", args: ["--user", "daemon-reload"] },
        {
          cmd: "systemctl",
          args: ["--user", "enable", `${COPILOT_APP_AGENT_LABEL}.service`],
        },
        // restart, not `enable --now`: `--now` is a no-op against an
        // already-active unit, which would leave a running app holding the
        // just-revoked previous ingest key (minting is hard-cut rotation).
        {
          cmd: "systemctl",
          args: ["--user", "restart", `${COPILOT_APP_AGENT_LABEL}.service`],
        },
      ];
    case "win32":
      return [
        {
          cmd: "schtasks",
          args: [
            "/Create",
            "/TN",
            COPILOT_APP_AGENT_LABEL,
            "/XML",
            descriptorPath,
            "/F",
          ],
        },
        // /Create only registers for the NEXT logon; start the task now so
        // "connected" is not a promise about a future login.
        {
          cmd: "schtasks",
          args: ["/Run", "/TN", COPILOT_APP_AGENT_LABEL],
        },
      ];
  }
}

/** The OS commands that unregister the agent, per platform. Every command
 * must succeed for the agent to be considered stopped. */
function unregisterCommands(platform: AppPlatform): OsCommand[] {
  switch (platform) {
    case "darwin":
      // Stop + boot out the running agent. If this fails the launchd job
      // may still be alive and exporting, so it is NOT tolerated on removal
      // when the agent is registered. (`bootout` returns real exit codes;
      // legacy `unload` exits 0 even on failure.)
      return [
        {
          cmd: "launchctl",
          args: ["bootout", `${launchdGuiDomain()}/${COPILOT_APP_AGENT_LABEL}`],
        },
      ];
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
        {
          cmd: "schtasks",
          args: ["/Delete", "/TN", COPILOT_APP_AGENT_LABEL, "/F"],
        },
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
      // Only the expected first-install darwin bootout is tolerated.
      // Every other service-manager failure means the agent is NOT
      // registered — unwind the token-bearing files just written (a
      // descriptor that failed to register would otherwise sit on disk as
      // a live credential the OS may still pick up at next login), then
      // surface it so the caller never reports a mint + "connected" while
      // capture is actually off.
      if (!tolerateFailure) {
        for (const file of descriptor.files) {
          io.removeFile(file.path);
        }
        throw new CopilotAppAgentError(
          "register",
          `${cmd} ${args.join(" ")}`,
          err,
        );
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
  const files = copilotAppAgentFiles(platform, home);
  if (!files.some((f) => io.fileExists(f))) return false; // nothing installed

  // A missing register descriptor means the OS registration is either gone
  // or unreachable (partial prior removal) — the surviving files are stray
  // credentials. Still ATTEMPT the unregister (the OS may hold a live
  // registration pointing at the stray wrapper), but tolerate its failure
  // so the stray token file is always deleted.
  const registered = io.fileExists(copilotAppAgentPath(platform, home));

  // Stop + unregister first. While registered, a failure means the agent
  // may still be loaded and exporting content; do NOT delete the descriptor
  // (that would remove the retry path) and do NOT report success — surface
  // the failure so `logout` prints it as "couldn't remove" rather than a
  // clean removal.
  for (const { cmd, args } of unregisterCommands(platform)) {
    try {
      io.run(cmd, args);
    } catch (err) {
      if (registered) {
        throw new CopilotAppAgentError(
          "unregister",
          `${cmd} ${args.join(" ")}`,
          err,
        );
      }
      // stray-file cleanup: unregister can legitimately fail when the OS
      // never had (or already lost) the registration — keep going so the
      // token-bearing files are removed.
    }
  }

  // Unregister succeeded (or nothing was registered) — delete every file
  // the agent wrote (descriptor + any launch wrapper).
  for (const file of files) {
    io.removeFile(file);
  }
  return true;
}
