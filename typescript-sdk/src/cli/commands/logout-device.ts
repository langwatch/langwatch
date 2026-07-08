import { isLoggedIn, loadConfig } from "@/cli/utils/governance/config";
import { revokeAndClearSession } from "./logout.js";

/**
 * `langwatch logout-device` — credentials-only logout: server-revoke the
 * refresh token AND clear the local config, but leave the telemetry
 * wiring in place. Kept as a stable alias for scripts; the full
 * `langwatch logout` additionally removes the persisted telemetry blocks.
 *
 * Idempotent: safe to run when not logged in.
 */
export const logoutDeviceCommand = async (): Promise<void> => {
  const wasLoggedIn = isLoggedIn(loadConfig());
  await revokeAndClearSession();
  console.log(
    wasLoggedIn
      ? "Logged out — local credentials cleared."
      : "Not logged in. Local config cleared (idempotent).",
  );
};
