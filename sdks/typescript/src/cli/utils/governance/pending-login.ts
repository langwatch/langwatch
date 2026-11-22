/**
 * The device code a login is waiting on, kept beside the config so a login that stops before the
 * person approves (an agent's command timeout, a closed terminal) is picked up by the next run.
 * @see specs/ai-gateway/governance/cli-login.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { z } from "zod";

import { configPath } from "./config";
import type { DeviceCode } from "./device-flow";

/** A code with less time left than this is not worth handing to a person. */
const MIN_REMAINING_MS = 60_000;

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
    fs.writeFileSync(file, JSON.stringify(record, null, 2), { mode: 0o600 });
  } catch {
    // Only the next run's shortcut is lost; this run still waits on the code.
  }
}

/**
 * The still-live code an earlier run of the same login left, as a device code with the time it
 * has left; undefined when there is none, it answers another request, or it is about to expire.
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
    pending.cwd === request.cwd;
  if (!sameRequest) return undefined;

  const remainingMs = pending.expires_at - now;
  if (remainingMs < MIN_REMAINING_MS) {
    clearPendingLogin();
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
    expires_in: Math.floor(remainingMs / 1000),
  };
}

/** Forgets the pending code once its login ends: signed in, denied or expired. */
export function clearPendingLogin(): void {
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

/** How long the person has to approve, said the way they would read it. */
export function expiryPhrase(expiresInSeconds: number): string {
  const minutes = Math.floor(expiresInSeconds / 60);
  if (minutes >= 2) return `${minutes} minutes`;
  if (minutes === 1) return "1 minute";
  return `${Math.max(0, expiresInSeconds)} seconds`;
}
