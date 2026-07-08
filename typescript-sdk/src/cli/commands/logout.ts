import * as readline from "node:readline";

import chalk from "chalk";

import {
  clearConfig,
  isLoggedIn,
  loadConfig,
} from "@/cli/utils/governance/config";
import {
  DeviceFlowError,
  logout as serverRevokeLogout,
} from "@/cli/utils/governance/device-flow";
import { scanTelemetryTargets } from "@/cli/utils/governance/telemetry-targets";

export interface LogoutOptions {
  /** Skip the confirmation prompt. */
  yes?: boolean;
  /** Remove telemetry wiring but keep the device session on disk. */
  keepCredentials?: boolean;
}

/**
 * Server-revoke the device refresh token AND clear the local
 * ~/.langwatch/config.json. Best-effort: the local clear happens even
 * when the remote revoke fails, so "logout" never leaves a usable token
 * on disk. Idempotent — safe when not logged in.
 *
 * Shared by `langwatch logout` and the credentials-only `logout-device`
 * alias.
 */
export const revokeAndClearSession = async (): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    clearConfig();
    return;
  }
  if (cfg.refresh_token) {
    try {
      // Send both tokens so the access_token is invalidated immediately,
      // not just at its 1h expiry.
      await serverRevokeLogout(
        { baseUrl: cfg.control_plane_url },
        cfg.refresh_token,
        cfg.access_token,
      );
    } catch (err) {
      const msg = err instanceof DeviceFlowError ? err.message : String(err);
      console.error(chalk.yellow(`warning: server-side revoke failed: ${msg}`));
    }
  }
  clearConfig();
};

const confirmProceed = async (question: string): Promise<boolean> => {
  // Non-interactive logout proceeds: it's an explicit destructive command,
  // so blocking a scripted `langwatch logout` on a prompt would be worse.
  if (!process.stdin.isTTY) return true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ans = await new Promise<string>((resolve) => {
    rl.question(`${question} [Y/n] `, (a) => resolve(a));
  });
  rl.close();
  const norm = ans.trim().toLowerCase();
  return norm === "" || norm === "y" || norm === "yes";
};

/**
 * `langwatch logout` — the full un-wire. Revokes + clears the device
 * session (unless --keep-credentials) AND discovers and removes every
 * langwatch-authored telemetry block across the wrapped tools. Scans
 * first, shows exactly what it found, confirms (unless --yes), then
 * removes; only marker-bracketed blocks / known key sets are touched, so
 * surrounding user config is preserved.
 */
export const logoutCommand = async (
  options: LogoutOptions = {},
): Promise<void> => {
  const present = scanTelemetryTargets().filter((t) => t.present);
  const willRevoke = !options.keepCredentials;
  const loggedIn = isLoggedIn(loadConfig());

  if (present.length === 0 && !(willRevoke && loggedIn)) {
    console.log(
      "Nothing to clean up — no telemetry wiring or device session found.",
    );
    return;
  }

  console.log("This will remove:");
  if (willRevoke && loggedIn) {
    console.log("  • the LangWatch device session (~/.langwatch/config.json)");
  }
  for (const t of present) {
    console.log(`  • ${t.label}`);
  }
  console.log();

  if (!options.yes) {
    const ok = await confirmProceed("Proceed?");
    if (!ok) {
      console.log("Aborted. Nothing was changed.");
      return;
    }
  }

  const removed: string[] = [];
  for (const t of present) {
    try {
      if (t.remove()) removed.push(t.label);
    } catch (err) {
      console.log(
        chalk.yellow(
          `  ! Couldn't remove ${t.label}: ${(err as Error).message}`,
        ),
      );
    }
  }

  if (willRevoke) {
    await revokeAndClearSession();
    if (loggedIn) removed.push("LangWatch device session");
  }

  console.log();
  if (removed.length === 0) {
    console.log("Done — nothing needed removing.");
    return;
  }
  console.log(chalk.green("Removed:"));
  for (const label of removed) {
    console.log(chalk.green(`  ✓ ${label}`));
  }
};
