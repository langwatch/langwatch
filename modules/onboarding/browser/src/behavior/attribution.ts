/**
 * First-touch acquisition attribution.
 */

let storageErrorReported = false;

/**
 * Canonical list of attribution fields. Single source of truth — add a
 * field here plus one line in `URL_PARAM_TO_FIELD` below if it's
 * URL-sourced, and everything downstream (types, readers, pickers) follows.
 */
export const ATTRIBUTION_FIELDS = [
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

/**
 * Analytics property name for each attribution field. UTM fields keep their
 * URL param name, which is also the name PostHog and Customer.io use.
 */
export const ATTRIBUTION_FIELD_TO_PROPERTY = {
  leadSource: "lead_source",
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmTerm: "utm_term",
  utmContent: "utm_content",
  referrer: "referrer",
} as const satisfies Record<AttributionField, string>;

export type AttributionProperty =
  (typeof ATTRIBUTION_FIELD_TO_PROPERTY)[AttributionField];

/**
 * Converts attribution fields to analytics event properties. Unset and empty
 * fields are left out, so an event without attribution carries no such keys.
 */
export function toAttributionProperties(
  attribution: Partial<Record<AttributionField, string | null | undefined>>,
): Partial<Record<AttributionProperty, string>> {
  const properties: Partial<Record<AttributionProperty, string>> = {};
  for (const field of ATTRIBUTION_FIELDS) {
    const value = attribution[field];
    if (value) properties[ATTRIBUTION_FIELD_TO_PROPERTY[field]] = value;
  }
  return properties;
}

const STORAGE_PREFIX = "lw_attrib.";

function storageKey(field: AttributionField): string {
  return STORAGE_PREFIX + field;
}

function reportStorageError(_error: unknown): void {
  if (storageErrorReported) return;
  storageErrorReported = true;
}

function safeGet(field: AttributionField): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(storageKey(field));
  } catch (error) {
    reportStorageError(error);
    return null;
  }
}

/**
 * Writes the value only if the key is currently unset (first-touch
 * semantics). Empty strings are ignored. No-op on SSR or when storage is
 * unavailable (private browsing).
 */
export function setAttributionIfAbsent(field: AttributionField, value: string): void {
  if (typeof window === "undefined") return;
  if (value.length === 0) return;
  try {
    const key = storageKey(field);
    if (window.sessionStorage.getItem(key) !== null) return;
    window.sessionStorage.setItem(key, value);
  } catch (error) {
    reportStorageError(error);
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
