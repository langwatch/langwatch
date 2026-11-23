/**
 * The device code a login is waiting on, kept beside the config so a login that stops before the
 * person approves (an agent's command timeout, a closed terminal) is picked up by the next run.
 * @see specs/ai-gateway/governance/cli-login.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { z } from "zod";

import { writeSecretFile } from "../secret-file";
import { configPath } from "./config";
import type { DeviceCode } from "./device-flow";

const pendingLoginSchema = z.object({
  control_plane_url: z.string(),
  kind: z.enum(["device_session", "project_api_key"]),
  management: z.boolean(),
  cwd: z.string(),
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string(),
  verification_uri_complete: z.string().optional(),
  interval: z.number().positive(),
  /** Epoch milliseconds the server stops honouring the code. */
  expires_at: z.number(),
});

export type PendingLogin = z.infer<typeof pendingLoginSchema>;

/** What a login asks for: a pending code answers only the same request. */
export type PendingLoginRequest = Pick<
  PendingLogin,
  "control_plane_url" | "kind" | "management" | "cwd"
>;

/** Next to the config it belongs to, so an isolated config keeps its own pending code. */
export function pendingLoginPath(): string {
  return `${configPath().replace(/\.json$/, "")}.pending-login.json`;
}

/** Remembers the code this login waits on, with mode 0600: the device code redeems a credential. */
export function savePendingLogin({
  request,
  deviceCode,
  now = Date.now(),
}: {
  request: PendingLoginRequest;
  deviceCode: DeviceCode;
  now?: number;
}): void {
  const record: PendingLogin = {
    ...request,
    device_code: deviceCode.device_code,
    user_code: deviceCode.user_code,
    verification_uri: deviceCode.verification_uri,
    ...(deviceCode.verification_uri_complete
      ? { verification_uri_complete: deviceCode.verification_uri_complete }
      : {}),
    interval: deviceCode.interval,
    expires_at: now + deviceCode.expires_in * 1000,
  };
  try {
    const file = pendingLoginPath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeSecretFile(file, JSON.stringify(record, null, 2));
  } catch {
    // Only the next run's shortcut is lost; this run still waits on the code.
  }
}

/**
 * The still-live code an earlier run of the same login left, as a device code with the time it
 * has left; undefined when there is none, it answers another request, or it has expired.
 */
export function resumablePendingLogin({
  request,
  now = Date.now(),
}: {
  request: PendingLoginRequest;
  now?: number;
}): DeviceCode | undefined {
  const pending = readPendingLogin();
  if (!pending) return undefined;

  const sameRequest =
    pending.control_plane_url === request.control_plane_url &&
    pending.kind === request.kind &&
    pending.management === request.management &&
    // Only a project key login writes into its folder (.env); a device session is machine-wide.
    (request.kind !== "project_api_key" || pending.cwd === request.cwd);
  if (!sameRequest) return undefined;

  // A code in its last seconds may already carry an approval: resume it and let the poll say.
  const remainingMs = pending.expires_at - now;
  if (remainingMs <= 0) {
    clearPendingLogin({ deviceCode: pending.device_code });
    return undefined;
  }

  return {
    device_code: pending.device_code,
    user_code: pending.user_code,
    verification_uri: pending.verification_uri,
    ...(pending.verification_uri_complete
      ? { verification_uri_complete: pending.verification_uri_complete }
      : {}),
    interval: pending.interval,
    expires_in: Math.max(1, Math.floor(remainingMs / 1000)),
  };
}

/** Forgets the pending code once its login ends, unless a later login saved its own since. */
export function clearPendingLogin({ deviceCode }: { deviceCode: string }): void {
  if (readPendingLogin()?.device_code !== deviceCode) return;
  try {
    fs.rmSync(pendingLoginPath(), { force: true });
  } catch {
    // A file that cannot be removed is refused by the next run's checks anyway.
  }
}

function readPendingLogin(): PendingLogin | undefined {
  try {
    const parsed = pendingLoginSchema.safeParse(
      JSON.parse(fs.readFileSync(pendingLoginPath(), "utf8")),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
