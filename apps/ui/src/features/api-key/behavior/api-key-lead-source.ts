/**
 * The first-touch acquisition source, stamped once — never overwrites an
 * existing value, so a reader who later runs `langwatch login` keeps their
 * real source. A storage refusal is swallowed.
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
