import { describe, expect, it } from "vitest";
import {
  getPlanManagementUrl,
  getPlanManagementButtonLabel,
} from "../usePlanManagementUrl";

/**
 * Pure unit tests for plan management URL utilities.
 * Testing the synchronous helper functions (pure functions).
 * Hook testing would require React testing setup.
 */

describe("getPlanManagementUrl", () => {
  it("returns subscription URL in SaaS mode", () => {
    expect(getPlanManagementUrl(true)).toBe("/settings/subscription");
  });

  it("returns license URL in self-hosted mode", () => {
    expect(getPlanManagementUrl(false)).toBe("/settings/license");
  });
});

describe("getPlanManagementButtonLabel", () => {
  it("returns 'Upgrade plan' in SaaS mode", () => {
    expect(getPlanManagementButtonLabel(true)).toBe("Upgrade plan");
  });

  it("returns 'Upgrade license' in self-hosted mode", () => {
    expect(getPlanManagementButtonLabel(false)).toBe("Upgrade license");
  });
});
