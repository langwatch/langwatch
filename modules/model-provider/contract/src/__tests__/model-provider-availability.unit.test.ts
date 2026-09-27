import { describe, expect, it } from "vitest";

import { hasEnabledModelProvider } from "../model-provider-availability.ts";

describe("hasEnabledModelProvider", () => {
  it("answers yes when one provider is switched on", () => {
    expect(
      hasEnabledModelProvider({ openai: { enabled: false }, anthropic: { enabled: true } }),
    ).toBe(true);
  });

  it("answers no when every provider is off, or there are none", () => {
    expect(hasEnabledModelProvider({ openai: { enabled: false } })).toBe(false);
    expect(hasEnabledModelProvider({})).toBe(false);
  });
});
