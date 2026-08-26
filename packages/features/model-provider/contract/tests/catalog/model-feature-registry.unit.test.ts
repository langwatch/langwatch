import { describe, expect, it } from "vitest";

import {
  allFeatures,
  assertUniqueFeatureKeys,
  type FeatureDescriptor,
  featureByKey,
  featuresByRole,
} from "../../src/catalog/model-feature-registry";

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

  /** @scenario "User-simulator and judge are registered as DEFAULT-role features" */
  it("registers the scenario simulator and judge as DEFAULT-role features", () => {
    expect(featureByKey("scenarios.user_simulator")?.role).toBe("DEFAULT");
    expect(featureByKey("scenarios.judge")?.role).toBe("DEFAULT");
  });

  /** @scenario "New scenario model features surface under the Default role expansion" */
  it("surfaces the scenario simulator and judge under the DEFAULT role expansion", () => {
    const defaultKeys = featuresByRole("DEFAULT").map((f) => f.key);
    expect(defaultKeys).toContain("scenarios.user_simulator");
    expect(defaultKeys).toContain("scenarios.judge");
  });

  describe("given the run-time agent-under-test feature", () => {
    describe("when it is looked up by key", () => {
      /** @scenario "A prompt without a model resolves the agent-under-test default" */
      it("registers it under the DEFAULT role", () => {
        const feature = featureByKey("scenarios.agent_under_test");
        expect(feature, 'feature "scenarios.agent_under_test" must exist').toBeTruthy();
        expect(feature?.role).toBe("DEFAULT");
      });

      it("carries customer-safe copy naming no internal machinery", () => {
        const feature = featureByKey("scenarios.agent_under_test");
        expect(feature?.displayName.length).toBeGreaterThan(0);
        expect(feature?.description.length).toBeGreaterThan(0);

        // Copy rules (dev/docs/best_practices/copywriting.md): no internal
        // service names, no abbreviations, no code-shaped identifiers.
        const copy = `${feature?.displayName} ${feature?.description}`.toLowerCase();
        for (const forbidden of [
          "prefetch",
          "adapter",
          "litellm",
          "nlpgo",
          "resolver",
          "codex",
        ]) {
          expect(
            copy,
            `copy must not mention internal term "${forbidden}"`,
          ).not.toContain(forbidden);
        }
      });
    });
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
