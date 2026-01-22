import { describe, expect, it } from "vitest";
import {
  isInternalSetId,
  isOnPlatformSet,
  getOnPlatformSetId,
  getDisplayName,
} from "./scenarioSetId";

describe("isInternalSetId", () => {
  it("detects internal sets by prefix", () => {
    expect(isInternalSetId("__internal__proj_123__on-platform-scenarios")).toBe(
      true
    );
  });

  it("returns false for user-created sets", () => {
    expect(isInternalSetId("my-custom-scenario-set")).toBe(false);
  });

  it("returns false for legacy local-scenarios", () => {
    expect(isInternalSetId("local-scenarios")).toBe(false);
  });

  it("handles edge cases", () => {
    // Empty string
    expect(isInternalSetId("")).toBe(false);

    // Prefix only
    expect(isInternalSetId("__internal__")).toBe(true);

    // Incomplete prefix
    expect(isInternalSetId("__internal")).toBe(false);
  });
});

describe("isOnPlatformSet", () => {
  it("detects on-platform sets by suffix", () => {
    expect(
      isOnPlatformSet("__internal__proj_123__on-platform-scenarios")
    ).toBe(true);
  });

  it("returns false for other internal sets", () => {
    expect(isOnPlatformSet("__internal__proj_123__other-type")).toBe(false);
  });

  it("returns false for user-created sets", () => {
    expect(isOnPlatformSet("user-scenarios-set")).toBe(false);
  });

  it("handles suffix-only matching", () => {
    // Suffix without prefix returns false
    expect(isOnPlatformSet("on-platform-scenarios")).toBe(false);

    // Proper pattern returns true
    expect(
      isOnPlatformSet("__internal__proj_xyz__on-platform-scenarios")
    ).toBe(true);
  });
});

describe("getOnPlatformSetId", () => {
  it("generates correct set ID", () => {
    expect(getOnPlatformSetId("proj_abc123")).toBe(
      "__internal__proj_abc123__on-platform-scenarios"
    );
  });

  it("handles various project ID formats", () => {
    expect(getOnPlatformSetId("my-project")).toBe(
      "__internal__my-project__on-platform-scenarios"
    );

    expect(getOnPlatformSetId("project_with_underscores")).toBe(
      "__internal__project_with_underscores__on-platform-scenarios"
    );
  });
});

describe("getDisplayName", () => {
  it("returns friendly name for internal on-platform sets", () => {
    expect(
      getDisplayName("__internal__proj_123__on-platform-scenarios")
    ).toBe("On-Platform Scenarios");
  });

  it("returns original name for user-created sets", () => {
    expect(getDisplayName("my-custom-set")).toBe("my-custom-set");
  });

  it("returns original name for non on-platform internal sets", () => {
    expect(getDisplayName("__internal__proj_123__other-type")).toBe(
      "__internal__proj_123__other-type"
    );
  });
});
