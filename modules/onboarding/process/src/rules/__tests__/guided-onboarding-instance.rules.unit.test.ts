/**
 * The gateway URL rides on the answer, computed from the instance's own
 * config on every read rather than stored on the organization's state.
 */
import { describe, expect, it } from "vitest";

import { withInstanceFacts } from "../guided-onboarding-instance.rules.ts";

describe("withInstanceFacts", () => {
  it("adds no gatewayUrl when the instance names no gateway", () => {
    expect(withInstanceFacts({ paths: [] }, { publicUrl: undefined })).toEqual({ paths: [] });
  });

  it("does not duplicate an already-versioned URL", () => {
    const result = withInstanceFacts({ paths: [] }, { publicUrl: "https://gw.example.com/v1" });
    expect(result.gatewayUrl).toBe("https://gw.example.com/v1");
  });
});
