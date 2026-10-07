/**
 * Only LangWatch Cloud judges with the classifier key (ADR-174 decision 14).
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */
import { describe, expect, it } from "vitest";

import { cloudClassifierKeyOf } from "../instant-eval-judge-cloud-key.rules.ts";

describe("cloudClassifierKeyOf", () => {
  describe("given LangWatch Cloud with the classifier key", () => {
    it("judges with it", () => {
      expect(cloudClassifierKeyOf({ isCloud: true, apiKey: "langwatch-key" })).toBe(
        "langwatch-key",
      );
    });
  });

  describe("given a self-hosted install that sets a judge key", () => {
    /** @scenario "A self-hosted install never judges with a judge key it sets" */
    it("ignores the key, so the install judges through Connect or not at all", () => {
      expect(cloudClassifierKeyOf({ isCloud: false, apiKey: "install-key" })).toBeUndefined();
    });
  });

  describe("given no key", () => {
    it("has nothing to judge with, on cloud or not", () => {
      expect(cloudClassifierKeyOf({ isCloud: true, apiKey: undefined })).toBeUndefined();
      expect(cloudClassifierKeyOf({ isCloud: false, apiKey: "" })).toBeUndefined();
    });
  });
});
