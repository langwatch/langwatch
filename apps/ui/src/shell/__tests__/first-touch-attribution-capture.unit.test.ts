/**
 * The shell resolves first-touch attribution capture from what onboarding lends by its client
 * token, and captures nothing in a build without onboarding (ARCHITECTURE.md §10.1).
 */
import { uiDeclarations } from "@langwatch/browser-host/declarations";
import { onboardingWeb } from "@langwatch/onboarding-browser/declaration";
import { describe, expect, it } from "vitest";

import { lentFirstTouchAttribution } from "../use-analytics-identity";

describe("lentFirstTouchAttribution", () => {
  describe("when onboarding is installed", () => {
    /** @scenario The shell captures first-touch attribution through onboarding's client token */
    it("resolves onboarding's capture and event properties", () => {
      const attribution = lentFirstTouchAttribution(uiDeclarations([onboardingWeb]));

      expect(attribution).toMatchObject({
        useCapture: expect.any(Function),
        eventProperties: expect.any(Function),
      });
    });
  });

  describe("when onboarding is not installed", () => {
    /** @scenario The shell captures first-touch attribution through onboarding's client token */
    it("resolves nothing, so the shell captures nothing", () => {
      expect(lentFirstTouchAttribution(uiDeclarations([]))).toBeUndefined();
    });
  });
});
