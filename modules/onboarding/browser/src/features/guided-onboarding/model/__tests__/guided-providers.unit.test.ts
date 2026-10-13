import { findProviderDeprecation, modelProviders } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { GUIDED_PROVIDERS, guidedProvidersFor } from "../guided-providers.ts";

describe("guidedProvidersFor", () => {
  /** @scenario "the provider screen offers every live guided provider" */
  it("keeps every curated provider that is a live llm registry entry", () => {
    const offered = guidedProvidersFor().map((provider) => provider.id);
    expect(offered).toEqual(GUIDED_PROVIDERS.map((provider) => provider.id));
  });

  it("resolves every curated provider to a real registry key", () => {
    for (const provider of GUIDED_PROVIDERS) {
      expect(guidedProvidersFor().some((p) => p.registryKey === provider.registryKey)).toBe(true);
    }
  });

  describe("given an install with no deployment-specific provider rule, as self-hosted is", () => {
    /** @scenario "The takeover offers Codex wherever the panel's model setup does" */
    it("starts with Codex and offers only what the panel's inline setup offers", () => {
      const offered = guidedProvidersFor();

      expect(offered[0]?.registryKey).toBe("openai_codex");
      for (const { registryKey } of offered) {
        expect(modelProviders[registryKey].type).toBe("llm");
        expect(findProviderDeprecation(registryKey)).toEqual([]);
      }
    });
  });
});
