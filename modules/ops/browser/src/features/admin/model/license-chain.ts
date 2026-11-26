/**
 * How the license drawer reads one reissue chain (ADR-156): which license the
 * install holds, which replacement waits for its next sync, and where a change
 * is signed. Pure, so the drawer and its tests read the same answer.
 */
import { Temporal, toDate } from "@langwatch/time";

import type { License } from "./license-terms.ts";

/** The install syncs once a day; Refresh license on the install syncs at once. */
export const SYNC_INTERVAL_HOURS = 24;

export interface LicenseChainState {
  /** Every license of the chain, the newest first. */
  licenses: License[];
  /** The newest license of the chain: every change is signed as its replacement. */
  head: License;
  /** The license the install holds, or the head when nothing waits for delivery. */
  inUse: License;
  /** The newest replacement the install has not picked up yet. */
  pending: License | null;
  /** The licenses not revoked or superseded: a revoke, reset or terms edit reaches each one. */
  live: License[];
  /** No live license of the chain is bound; a retired one may still name the old install. */
  unbound: boolean;
  /** Replaced keys no install used that still work, because ending them failed. */
  leftover: License[];
}

const isLive = (license: License) => license.status === "active" || license.status === "expired";

/** `licenses` is the chain the registry answered, the newest first. */
export function licenseChainState({ licenses }: { licenses: License[] }): LicenseChainState | null {
  const [head] = licenses;
  if (!head) return null;
  const live = licenses.filter(isLive);
  const pending = head.hasPendingDelivery && isLive(head) ? head : null;
  const inUse = pending
    ? (licenses.find((license) => isLive(license) && !license.hasPendingDelivery) ?? head)
    : head;
  const unbound = live.every((license) => license.instanceId === null);
  const leftover = unbound ? live.filter((license) => license.id !== head.id) : [];
  return { licenses, head, inUse, pending, live, unbound, leftover };
}

/** When the next daily sync is due, worked out from the last one; nothing stored. */
export function nextSyncText({ lastSyncAt, nowMs }: { lastSyncAt: string; nowMs: number }): string {
  const dueMs = Temporal.Instant.from(lastSyncAt).add({
    hours: SYNC_INTERVAL_HOURS,
  }).epochMilliseconds;
  const hours = Math.ceil((dueMs - nowMs) / 3_600_000);
  if (hours <= 0) return "next sync due now";
  if (hours === 1) return "next sync in about an hour";
  return `next sync in about ${hours} hours`;
}

/** The replacement the install applied in the last day, with the instant it did, or null. */
export function recentlyApplied({
  chain,
  nowMs,
}: {
  chain: LicenseChainState;
  nowMs: number;
}): { replaced: License; appliedAt: string } | null {
  const [head, replaced] = chain.licenses;
  if (!head || !replaced || chain.pending || !replaced.supersededAt) return null;
  if (replaced.id !== head.replacesId) return null;
  const ageMs = nowMs - Temporal.Instant.from(replaced.supersededAt).epochMilliseconds;
  return ageMs < SYNC_INTERVAL_HOURS * 3_600_000
    ? { replaced, appliedAt: replaced.supersededAt }
    : null;
}

/** A calendar day the way the drawer prints it: "Dec 1, 2026". */
export function formatDay(value: string): string {
  return toDate(Temporal.Instant.from(value)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** A moment the way the drawer prints it: "Nov 25, 2026, 4:52 PM". */
export function formatMoment(value: string): string {
  return toDate(Temporal.Instant.from(value)).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A term from issue to end: "Oct 1 to Dec 1, 2026". */
export function formatTerm({ from, to }: { from: string; to: string }): string {
  return `${formatDay(from)} to ${formatDay(to)}`;
}

/** What the customer can be sent when a change waits for their install. */
export function customerSyncMessage({
  change,
  install,
}: {
  change: string;
  install: string;
}): string {
  return `Hi, we ${change}. It reaches ${install} by itself within a day. To get it now, open Settings, License and press Refresh license. Nothing to paste.`;
}
