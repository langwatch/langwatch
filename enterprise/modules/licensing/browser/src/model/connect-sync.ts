/**
 * The sync line the License and Connect pages share, and the refusals that
 * close hosted services, read from the same Connect status.
 * @see specs/self-hosting/connected-services/license-sync.feature
 */

import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import type { ConnectStatus } from "@langwatch/enterprise-licensing-contract";
import { Temporal } from "@langwatch/time";

type ConnectEnabled = Extract<ConnectStatus, { deployment: "on" }>;

/** The code LangWatch answers once it revoked a license. */
export const LICENSE_REVOKED_CODE = "connect_license_revoked";

/** Refusals of the license itself: while one stands, no hosted service can run. */
const LICENSE_REFUSAL_CODES: ReadonlySet<string> = new Set([
  LICENSE_REVOKED_CODE,
  "connect_license_expired",
  "connect_license_not_registered",
  "connect_wrong_instance",
]);

/** "Last synced 5 minutes ago", or "Not synced yet" when no sync ever succeeded. */
export function lastSyncedText(lastSyncAt: string | null): string {
  if (!lastSyncAt) return "Not synced yet";
  try {
    const when = formatTimeAgo(Temporal.Instant.from(lastSyncAt).epochMilliseconds);
    return when ? `Last synced ${when}` : "Not synced yet";
  } catch {
    return "Not synced yet";
  }
}

/** The sync line: when it last succeeded, led by the failure when the last one failed. */
export function syncLineOf(sync: ConnectEnabled["sync"]): { text: string; failed: boolean } {
  const synced = lastSyncedText(sync.lastSyncAt);
  if (!sync.lastError) return { text: synced, failed: false };
  return { text: `Last sync failed. ${synced}.`, failed: true };
}

/** Whether LangWatch revoked this license, by the live refusal or the last sync. */
export function isRevokedByLangWatch(status: Pick<ConnectEnabled, "refusal" | "sync">): boolean {
  return (
    status.refusal?.code === LICENSE_REVOKED_CODE ||
    status.sync.lastError?.code === LICENSE_REVOKED_CODE
  );
}

/** Whether a refusal of the license stands, so every hosted service is unavailable. */
export function areHostedServicesClosed(status: Pick<ConnectEnabled, "refusal" | "sync">): boolean {
  const codes = [status.refusal?.code, status.sync.lastError?.code];
  return codes.some((code) => code !== undefined && LICENSE_REFUSAL_CODES.has(code));
}
