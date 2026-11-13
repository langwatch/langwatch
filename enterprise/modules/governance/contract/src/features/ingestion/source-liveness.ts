// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Whether an ingestion source takes events: the one answer every door asks.
 *
 * The push receivers, the pull scheduler, the pull worker and every screen
 * that shows a source as on or off read it from here. When the push door
 * spelled it as "not archived" while pull spelled it as "not disabled", a
 * disabled source kept ingesting (GOV-01). The `ingestion-source-status-literal`
 * lint rule reports any other spelling in the governance module.
 */

/** The statuses that take events. Anything else, a status no release knows included, is off. */
const LIVE_STATUSES: ReadonlySet<string> = new Set(["active", "awaiting_first_event"]);

/** An admin switched the source off (archiving does too), or the status is one no rule names. */
export function ingestionSourceStatusIsOff(status: string): boolean {
  return !LIVE_STATUSES.has(status);
}

/**
 * Neither archived nor switched off: the source takes events, pushed or pulled.
 * `archivedAt` is an instant or date on the server and an ISO string on the wire.
 */
export function ingestionSourceIsLive(source: {
  status: string;
  archivedAt: object | string | null;
}): boolean {
  return source.archivedAt === null && !ingestionSourceStatusIsOff(source.status);
}
