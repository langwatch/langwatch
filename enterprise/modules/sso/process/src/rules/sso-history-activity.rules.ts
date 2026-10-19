// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * How often the signal re-reads the history to see whether the newest event
 * moved. An administrator on this page is not watching a trace stream: a few
 * seconds on "a domain was just verified" costs what a reload would have.
 */
export const HISTORY_ACTIVITY_POLL_MS = 4_000;

/**
 * Has the connection's newest event changed since the previous poll? Pure, so
 * the tick decision is testable without driving a generator against a clock.
 */
export function historyActivityChanged({
  current,
  previous,
}: {
  current: string | null;
  previous: string | null;
}): boolean {
  return current !== previous;
}
