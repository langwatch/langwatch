/**
 * First-touch attribution, published for the shell: it mounts the capture at
 * its outermost provider position and reads the properties for the events it
 * sends about the signed-in reader.
 */
import type { UiFirstTouchAttribution } from "@langwatch/browser-host/declarations";
import { toAttributionProperties } from "@langwatch/onboarding-contract";

import { type AttributionField, readAttribution, URL_PARAM_TO_FIELD } from "./attribution.ts";
import { useAttributionCapture } from "./use-attribution-capture.ts";

/**
 * Attribution from one source as a whole, so two campaigns are never mixed:
 * the UTM and `ref` params of the current URL when it has any, otherwise the
 * stored first-touch fields.
 */
function attributionEventProperties(): Readonly<Record<string, string>> {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  const fromUrl: Partial<Record<AttributionField, string>> = {};
  for (const [urlParam, field] of Object.entries(URL_PARAM_TO_FIELD) as [
    string,
    AttributionField,
  ][]) {
    const value = params.get(urlParam);
    if (value) fromUrl[field] = value;
  }

  return toAttributionProperties(Object.keys(fromUrl).length > 0 ? fromUrl : readAttribution());
}

export const onboardingFirstTouchAttribution: UiFirstTouchAttribution = {
  useCapture: useAttributionCapture,
  eventProperties: attributionEventProperties,
};
