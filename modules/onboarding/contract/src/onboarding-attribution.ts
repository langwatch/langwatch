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
