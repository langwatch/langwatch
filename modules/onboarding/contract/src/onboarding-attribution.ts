/**
 * First-touch acquisition attribution field names. The canonical list — the
 * browser half's capture/read behaviour and this contract's sign-up schema
 * both derive from it, so a new field is added once, here.
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
 * Maps URL search param -> internal Attribution field. `referrer` is
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

export type AttributionProperty = (typeof ATTRIBUTION_FIELD_TO_PROPERTY)[AttributionField];

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
