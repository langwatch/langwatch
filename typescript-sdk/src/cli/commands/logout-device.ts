import chalk from "chalk";
import {
  loadConfig,
  clearConfig,
  isLoggedIn,
} from "@/cli/utils/governance/config";
import { logout as serverRevokeLogout, DeviceFlowError } from "@/cli/utils/governance/device-flow";

/**
 * `langwatch logout --device` — server-revoke the refresh token
 * AND clear the local config. Best-effort: if the server call
 * fails (network down, 5xx), the local clear still happens —
 * otherwise "logout" leaves a usable token on disk and the user
 * has to remember to delete the file manually.
 *
 * Idempotent: safe to run when not logged in.
 *
 * The bare `langwatch logout` (no flag) is reserved by the existing
 * API-key flow; this is namespaced under `--device` to avoid
 * regressing the existing CLI surface.
 */
export const logoutDeviceCommand = async (): Promise<void> => {
  const cfg = loadConfig();
  if (!isLoggedIn(cfg)) {
    clearConfig();
    console.log("Not logged in — local config cleared (idempotent).");
    return;
  }

  if (cfg.refresh_token) {
    try {
      // Send both tokens so the access_token is invalidated
      // immediately (Sergey's e7a042c69 closes the 1h-survival gap).
      await serverRevokeLogout(
        { baseUrl: cfg.control_plane_url },
        cfg.refresh_token,
        cfg.access_token,
      );
    } catch (err) {
      // Server-side revoke failed; we still want to clear locally
      // per the spec ("local wipe must happen even when remote
      // revoke fails — otherwise leaves a usable token on disk").
      const msg = err instanceof DeviceFlowError ? err.message : String(err);
      console.error(chalk.yellow(`warning: server-side revoke failed: ${msg}`));
    }
  }
  clearConfig();
  console.log("Logged out — local credentials cleared.");
};
