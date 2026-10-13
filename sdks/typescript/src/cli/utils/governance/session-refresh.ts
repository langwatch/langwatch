/**
 * Keeps a device-login session alive: on rejection the CLI trades the
 * refresh token for a fresh pair. Rotation is single-use server-side, so a
 * race between two sessions re-reads config and retries with the winner's pair.
 */

import type { GovernanceConfig } from "./config";
import { loadConfig, saveConfig } from "./config";
import * as deviceFlow from "./device-flow";

/**
 * Treat an access token as spent this many seconds before its stated
 * expiry. Covers clock skew between the device and the control plane
 * plus the round trip of the request about to be sent.
 */
export const ACCESS_TOKEN_EXPIRY_SKEW_SECONDS = 60;

export interface SessionRefreshDeps {
  /** Seam for tests; defaults to the real `/api/auth/cli/refresh` call. */
  refreshImpl?: typeof deviceFlow.refresh;
  /** Seam for tests; defaults to reading ~/.langwatch/config.json. */
  loadImpl?: typeof loadConfig;
  /** Seam for tests; defaults to writing ~/.langwatch/config.json. */
  saveImpl?: typeof saveConfig;
  fetchImpl?: typeof fetch;
}

/**
 * Whether `cfg.access_token` is at or past its recorded expiry. False when
 * there's no recorded expiry: pre-`expires_at` and `--api-key` sessions keep
 * the old behaviour of trying the call and handling the 401.
 */
export function isAccessTokenExpired(
  cfg: GovernanceConfig,
  nowMs: number = Date.now(),
  skewSeconds: number = ACCESS_TOKEN_EXPIRY_SKEW_SECONDS,
): boolean {
  if (!cfg.expires_at) return false;
  return nowMs / 1000 >= cfg.expires_at - skewSeconds;
}

/** Whether this config carries the material needed to refresh at all. */
export function canRefreshSession(cfg: GovernanceConfig): boolean {
  return !!cfg.refresh_token;
}

export type SessionRefreshOutcome =
  /** A fresh access token is now on `cfg` and persisted. */
  | { status: "refreshed" }
  /** No refresh token on this config; only a fresh login can help. */
  | { status: "unavailable" }
  /** The server rejected the refresh token: revoked, or idle too long. */
  | { status: "rejected"; message: string }
  /** Control plane unreachable; the existing token may still be fine. */
  | { status: "failed"; message: string };

/**
 * The reason a refresh failed, as a string worth showing someone. A
 * polyfilled fetch can reject with a bare string or an `AbortError`-shaped
 * object, where `(err as Error).message` is `undefined`.
 */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function applyRefreshResult(
  cfg: GovernanceConfig,
  result: deviceFlow.RefreshResult,
  saveImpl: typeof saveConfig,
): void {
  cfg.access_token = result.access_token;
  cfg.refresh_token = result.refresh_token;
  cfg.expires_at = Math.floor(Date.now() / 1000) + result.expires_in;
  try {
    saveImpl(cfg);
  } catch {
    // A read-only home directory still gets a working token for this
    // run; the next run just refreshes again.
    void 0;
  }
}

async function recoverRejectedRefresh({
  cfg,
  err,
  attempted,
  opts,
  refreshImpl,
  loadImpl,
  saveImpl,
}: {
  cfg: GovernanceConfig;
  err: unknown;
  attempted: string;
  opts: deviceFlow.DeviceFlowOptions;
  refreshImpl: typeof deviceFlow.refresh;
  loadImpl: typeof loadConfig;
  saveImpl: typeof saveConfig;
}): Promise<SessionRefreshOutcome> {
  const rejected = err instanceof deviceFlow.DeviceFlowError && err.kind === "unauthorized";
  if (!rejected) {
    return { status: "failed", message: messageOf(err) };
  }

  let onDisk: GovernanceConfig | null = null;
  try {
    onDisk = loadImpl();
  } catch {
    onDisk = null;
  }
  const rotated = onDisk?.refresh_token;
  if (!rotated || rotated === attempted) {
    return { status: "rejected", message: messageOf(err) };
  }

  try {
    applyRefreshResult(cfg, await refreshImpl(opts, rotated), saveImpl);
    return { status: "refreshed" };
  } catch (retryError) {
    const retryRejected =
      retryError instanceof deviceFlow.DeviceFlowError && retryError.kind === "unauthorized";
    return {
      status: retryRejected ? "rejected" : "failed",
      message: messageOf(retryError),
    };
  }
}

/**
 * Trades `cfg.refresh_token` for a fresh pair, mutating and persisting
 * `cfg`. On a server rejection, the config is re-read once in case a
 * sibling CLI process rotated it first, trying its newer token before giving up.
 */
export async function refreshSession(
  cfg: GovernanceConfig,
  deps: SessionRefreshDeps = {},
): Promise<SessionRefreshOutcome> {
  const refreshImpl = deps.refreshImpl ?? deviceFlow.refresh;
  const loadImpl = deps.loadImpl ?? loadConfig;
  const saveImpl = deps.saveImpl ?? saveConfig;
  const opts: deviceFlow.DeviceFlowOptions = {
    baseUrl: cfg.control_plane_url,
    fetchImpl: deps.fetchImpl,
  };

  const attempted = cfg.refresh_token;
  if (!attempted) return { status: "unavailable" };

  try {
    applyRefreshResult(cfg, await refreshImpl(opts, attempted), saveImpl);
    return { status: "refreshed" };
  } catch (err) {
    return recoverRejectedRefresh({
      cfg,
      err,
      attempted,
      opts,
      refreshImpl,
      loadImpl,
      saveImpl,
    });
  }
}

/**
 * Refresh only when the recorded expiry says the access token is spent.
 * Called before an authenticated request so the common case costs one
 * round trip instead of a guaranteed 401 followed by a retry.
 */
export async function refreshSessionIfExpired(
  cfg: GovernanceConfig,
  deps: SessionRefreshDeps = {},
): Promise<SessionRefreshOutcome | null> {
  if (!isAccessTokenExpired(cfg)) return null;
  if (!canRefreshSession(cfg)) return { status: "unavailable" };
  return refreshSession(cfg, deps);
}
