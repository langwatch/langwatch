import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION_FIELDS,
  ATTRIBUTION_FIELD_TO_PROPERTY,
  toAttributionProperties,
} from "../onboarding-attribution.ts";

describe("toAttributionProperties", () => {
  it("names every attribution field as its analytics property", () => {
    const attribution = Object.fromEntries(ATTRIBUTION_FIELDS.map((field) => [field, field]));

    expect(toAttributionProperties(attribution)).toEqual({
      lead_source: "leadSource",
      utm_source: "utmSource",
      utm_medium: "utmMedium",
      utm_campaign: "utmCampaign",
      utm_term: "utmTerm",
      utm_content: "utmContent",
      referrer: "referrer",
    });
    expect(Object.keys(ATTRIBUTION_FIELD_TO_PROPERTY)).toEqual([...ATTRIBUTION_FIELDS]);
  });

  it("leaves out unset and empty fields, and anything that is not attribution", () => {
    const answers = {
      utmSource: "newsletter",
      utmMedium: null,
      utmCampaign: "",
      utmTerm: undefined,
      yourRole: "engineer",
    };

    expect(toAttributionProperties(answers)).toEqual({ utm_source: "newsletter" });
  });
});
