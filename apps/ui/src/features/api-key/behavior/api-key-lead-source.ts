/**
 * The first-touch acquisition source, stamped once.
 *
 * `platform/app/src/utils/attribution.ts` owns the `lw_attrib.` session-storage
 * convention and stays with its capture hook and its signup reader; this file
 * knows one key of it. A value already recorded is never overwritten, so a
 * reader who originally arrived through a campaign and later runs
 * `langwatch login` keeps their real source. Storage can throw outright (a
 * browser set to block site data), and a lead source is not worth failing a
 * page over, so a refusal is swallowed.
 */

import type { UiBrowserStorage } from "../../../behavior/ui-browser-storage";

export const ATTRIBUTION_STORAGE_PREFIX = "lw_attrib.";
export const LEAD_SOURCE_FIELD = "leadSource";

export function recordLeadSourceIfAbsent({
  storage,
  source,
}: {
  storage: UiBrowserStorage;
  source: string;
}): void {
  const key = `${ATTRIBUTION_STORAGE_PREFIX}${LEAD_SOURCE_FIELD}`;
  try {
    if (storage.getItem(key) !== null) return;
    storage.setItem(key, source);
  } catch {
    // Storage is unavailable or full. Attribution is a nicety; the page is not.
  }
}
