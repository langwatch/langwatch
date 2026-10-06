import { describe, expect, it } from "vitest";

import { installUiFeatures, uiFeature } from "../ui-feature.ts";
import { resolveUiPageLoader, type UiPageLoader } from "../ui-page-loaders.ts";

function aLoader(): UiPageLoader {
  return async () => ({ default: () => null });
}

describe("given features composed with installUiFeatures", () => {
  describe("when two features serve the same page key", () => {
    /** @scenario Two features serving the same page key are refused by name */
    it("refuses the composition, naming both features and the shared page key", () => {
      const traces = uiFeature({ name: "traces", loaders: { "pages/shared": aLoader() } });
      const datasets = uiFeature({ name: "datasets", loaders: { "pages/shared": aLoader() } });

      expect(() => installUiFeatures({ features: [traces, datasets] })).toThrow(
        'Page key "pages/shared" is served by both "traces" and "datasets"',
      );
    });
  });

  describe("when two features serve the same drawer name", () => {
    /** @scenario Two features serving the same drawer name are refused by name */
    it("refuses the composition, naming both features and the shared drawer name", () => {
      const traces = uiFeature({ name: "traces", drawers: { traceDetails: () => null } });
      const scenarios = uiFeature({ name: "scenarios", drawers: { traceDetails: () => null } });

      expect(() => installUiFeatures({ features: [traces, scenarios] })).toThrow(
        'Drawer "traceDetails" is served by both "traces" and "scenarios"',
      );
    });
  });

  describe("when a feature was built with no api binding", () => {
    /** @scenario A feature without an api still serves its pages */
    it("contributes no Provider, and its own page loaders still resolve", () => {
      const loader = aLoader();
      const plain = uiFeature({ name: "plain", loaders: { "pages/plain": loader } });
      const withApi = uiFeature({
        name: "withApi",
        api: { Provider: () => null },
        loaders: { "pages/withApi": aLoader() },
      });

      const alone = installUiFeatures({ features: [plain] });
      const together = installUiFeatures({ features: [plain, withApi] });

      expect(plain.api).toBeUndefined();
      expect(alone.apis).toEqual([]);
      expect(together.apis?.map((binding) => binding.name)).toEqual(["withApi"]);
      expect(resolveUiPageLoader({ registry: alone.loaders ?? {}, key: "pages/plain" })).toBe(
        loader,
      );
    });
  });
});
