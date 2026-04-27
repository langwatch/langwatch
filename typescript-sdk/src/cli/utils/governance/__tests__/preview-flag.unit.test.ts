import { describe, it, expect } from "vitest";
import {
  isGovernancePreviewEnabled,
  GOVERNANCE_PREVIEW_ENV_VAR,
  GOVERNANCE_PREVIEW_DISABLED_MESSAGE,
} from "../preview-flag";

describe("isGovernancePreviewEnabled", () => {
  it("returns false when the env var is unset", () => {
    expect(isGovernancePreviewEnabled({})).toBe(false);
  });

  it("returns false when the env var is empty", () => {
    expect(isGovernancePreviewEnabled({ [GOVERNANCE_PREVIEW_ENV_VAR]: "" })).toBe(false);
  });

  it.each(["1", "true", "yes", "on", "TRUE", "True", "  1  "])(
    "returns true for truthy value %j",
    (value) => {
      expect(
        isGovernancePreviewEnabled({ [GOVERNANCE_PREVIEW_ENV_VAR]: value }),
      ).toBe(true);
    },
  );

  it.each(["0", "false", "no", "off", "preview", "enabled", "2"])(
    "returns false for non-truthy value %j",
    (value) => {
      expect(
        isGovernancePreviewEnabled({ [GOVERNANCE_PREVIEW_ENV_VAR]: value }),
      ).toBe(false);
    },
  );
});

describe("GOVERNANCE_PREVIEW_DISABLED_MESSAGE", () => {
  it("names the env var so users know how to opt in", () => {
    expect(GOVERNANCE_PREVIEW_DISABLED_MESSAGE).toContain(GOVERNANCE_PREVIEW_ENV_VAR);
    expect(GOVERNANCE_PREVIEW_DISABLED_MESSAGE).toContain("=1");
  });
});
