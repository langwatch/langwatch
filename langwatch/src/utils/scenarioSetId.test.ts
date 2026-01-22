import { describe, expect, it } from "vitest";
import {
  isInternalSetId,
  isOnPlatformSetId,
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

describe("isOnPlatformSetId", () => {
  it("detects on-platform sets by suffix", () => {
    expect(
      isOnPlatformSetId("__internal__proj_123__on-platform-scenarios")
    ).toBe(true);
  });

  it("returns false for other internal sets", () => {
    expect(isOnPlatformSetId("__internal__proj_123__other-type")).toBe(false);
  });

  it("returns false for user-created sets", () => {
    expect(isOnPlatformSetId("user-scenarios-set")).toBe(false);
  });

  it("handles suffix-only matching", () => {
    // Suffix without prefix returns false
    expect(isOnPlatformSetId("on-platform-scenarios")).toBe(false);

    // Proper pattern returns true
    expect(
      isOnPlatformSetId("__internal__proj_xyz__on-platform-scenarios")
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

  it("produces IDs recognized by isOnPlatformSetId (round-trip)", () => {
    const projectIds = ["proj_123", "my-project", "test"];
    for (const projectId of projectIds) {
      const setId = getOnPlatformSetId(projectId);
      expect(isOnPlatformSetId(setId)).toBe(true);
    }
  });

  it("handles edge case: empty string project ID", () => {
    const setId = getOnPlatformSetId("");
    expect(setId).toBe("__internal____on-platform-scenarios");
    expect(isOnPlatformSetId(setId)).toBe(true);
  });

  it("handles edge case: project ID with special characters", () => {
    const setId = getOnPlatformSetId("proj@123!#$%");
    expect(isOnPlatformSetId(setId)).toBe(true);
  });

  it("handles edge case: project ID containing underscores (potential delimiter conflict)", () => {
    // Project IDs with underscores should still produce valid set IDs
    const setId = getOnPlatformSetId("proj__with__double__underscores");
    expect(isOnPlatformSetId(setId)).toBe(true);

    // The set ID format still works even with embedded underscores
    const singleUnderscore = getOnPlatformSetId("proj_single");
    expect(isOnPlatformSetId(singleUnderscore)).toBe(true);
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
