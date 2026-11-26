/**
 * The reader's zone, read once from the browser, so a widget's labels (`LW.dashboardContext`)
 * and its query buckets (`{dashboard_context_timezone:String}`) agree on one clock.
 */

import { isLangWatchQLTimeZone, LWQL_DEFAULT_TIME_ZONE } from "@langwatch/analytics-contract";

/** The browser's IANA zone, or UTC when it names none the server would accept. */
export function browserTimeZone(): string {
  const zone: string | undefined = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone !== undefined && isLangWatchQLTimeZone(zone) ? zone : LWQL_DEFAULT_TIME_ZONE;
}
