/**
 * Spec: specs/analytics/posthog-campaign-conversion.feature
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { onboardingFirstTouchAttribution } from "../first-touch-attribution.capability.ts";

function setUrl(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

describe("onboardingFirstTouchAttribution", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setUrl("");
  });

  describe("given a landing URL that carried a campaign", () => {
    beforeEach(() => {
      setUrl("?utm_source=newsletter&utm_medium=email&utm_campaign=weekly-42&ref=website");
      renderHook(() => onboardingFirstTouchAttribution.useCapture());
    });

    describe("when the reader has navigated away from the landing URL", () => {
      it("answers the stored first-touch fields under their analytics names", () => {
        setUrl("");

        expect(onboardingFirstTouchAttribution.eventProperties()).toEqual({
          lead_source: "website",
          utm_source: "newsletter",
          utm_medium: "email",
          utm_campaign: "weekly-42",
        });
      });
    });

    describe("when the current URL carries another campaign", () => {
      /** @scenario UTM params on the current URL are reported on signed_in */
      it("answers the current URL's params on top of the stored ones", () => {
        setUrl("?utm_campaign=weekly-43&utm_content=cta");

        expect(onboardingFirstTouchAttribution.eventProperties()).toEqual({
          lead_source: "website",
          utm_source: "newsletter",
          utm_medium: "email",
          utm_campaign: "weekly-43",
          utm_content: "cta",
        });
      });
    });
  });

  describe("given no attribution was ever captured", () => {
    it("answers no property at all", () => {
      expect(onboardingFirstTouchAttribution.eventProperties()).toEqual({});
    });
  });
});
