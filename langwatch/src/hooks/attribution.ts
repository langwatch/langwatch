/**
 * First-touch acquisition attribution.
 *
 * Captures `?ref=` + `utm_*` URL params and `document.referrer` into
 * sessionStorage (first-touch: never overwritten), and reads them back into
 * a structured `Attribution` object for downstream consumers (signup
 * mutation, Customer.io identify/track).
 *
 * Pure module — no React. The mount-time write effect lives in
 * `useAttributionCapture.ts`, which imports from here.
 */

/**
 * Canonical list of attribution fields. Single source of truth — add a
 * field here plus one line in `URL_PARAM_TO_FIELD` below if it's
 * URL-sourced, and everything downstream (types, readers, pickers) follows.
 */
const ATTRIBUTION_FIELDS = [
  "leadSource",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "referrer",
] as const;

export type AttributionField = (typeof ATTRIBUTION_FIELDS)[number];
export type Attribution = Record<AttributionField, string | null>;

/**
 * Maps URL search param → internal Attribution field. `referrer` is
 * intentionally absent because it comes from `document.referrer`, not the
 * query string.
 */
export const URL_PARAM_TO_FIELD = {
  ref: "leadSource",
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
  utm_term: "utmTerm",
  utm_content: "utmContent",
} as const satisfies Record<string, AttributionField>;

const STORAGE_PREFIX = "lw_attrib.";

function storageKey(field: AttributionField): string {
  return STORAGE_PREFIX + field;
}

function safeGet(field: AttributionField): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(storageKey(field));
  } catch {
    return null;
  }
}

/**
 * Writes the value only if the key is currently unset (first-touch
 * semantics). Empty strings are ignored. No-op on SSR or when storage is
 * unavailable (private browsing).
 */
export function setAttributionIfAbsent(
  field: AttributionField,
  value: string,
): void {
  if (typeof window === "undefined") return;
  if (value.length === 0) return;
  try {
    const key = storageKey(field);
    if (window.sessionStorage.getItem(key) !== null) return;
    window.sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage may be unavailable (private browsing, disabled) — ignore.
  }
}

/** Reads every attribution field from sessionStorage. Unset fields → null. */
export function readAttribution(): Attribution {
  const result = {} as Attribution;
  for (const field of ATTRIBUTION_FIELDS) {
    result[field] = safeGet(field);
  }
  return result;
}

/**
 * Projects any object containing attribution fields onto the `Attribution`
 * shape. Missing fields become null. Useful for extracting the attribution
 * subset from a larger form object without repeating the field list at
 * every call site.
 */
export function pickAttribution(source: Partial<Attribution>): Attribution {
  const result = {} as Attribution;
  for (const field of ATTRIBUTION_FIELDS) {
    result[field] = source[field] ?? null;
  }
  return result;
}
