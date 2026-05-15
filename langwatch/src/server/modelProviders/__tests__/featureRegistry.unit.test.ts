import { describe, it, expect } from "vitest";

import {
  allFeatures,
  assertUniqueFeatureKeys,
  featureByKey,
  featuresByRole,
  type FeatureDescriptor,
} from "../featureRegistry";

describe("feature registry", () => {
  /** @scenario featuresByRole returns every declaration for that role */
  it("returns every declaration under a given role", () => {
    const fast = featuresByRole("FAST");
    expect(fast.length).toBeGreaterThanOrEqual(2);
    for (const f of fast) {
      expect(f.role).toBe("FAST");
    }

    const embeddings = featuresByRole("EMBEDDINGS");
    expect(embeddings.length).toBeGreaterThanOrEqual(1);
    for (const f of embeddings) {
      expect(f.role).toBe("EMBEDDINGS");
    }
  });

  it("looks up by key", () => {
    const f = featureByKey("traces.ai_search");
    expect(f?.role).toBe("FAST");
    expect(f?.displayName).toBe("AI search");
  });

  it("returns undefined for an unknown key", () => {
    expect(featureByKey("not-a-real-key")).toBeUndefined();
  });

  it("guarantees stable keys (snake_case, area-prefixed)", () => {
    for (const f of allFeatures()) {
      expect(f.key).toMatch(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/);
    }
  });

  it("never ships an empty registry", () => {
    expect(allFeatures().length).toBeGreaterThan(0);
  });

  /** @scenario Registering a feature key twice is a build-time failure */
  it("rejects duplicate keys at registration time", () => {
    const features: FeatureDescriptor[] = [
      {
        key: "duplicate.feature",
        role: "DEFAULT",
        displayName: "First",
        description: "",
      },
      {
        key: "duplicate.feature",
        role: "FAST",
        displayName: "Second",
        description: "",
      },
    ];
    expect(() => assertUniqueFeatureKeys(features)).toThrow(
      /Duplicate feature registry key/,
    );
  });
});
