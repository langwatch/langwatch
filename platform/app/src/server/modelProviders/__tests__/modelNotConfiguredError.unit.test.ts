/**
 * The refusal an unresolvable feature model raises. An agent driving the API,
 * the CLI or MCP has no settings page in front of it, so the remediation has to
 * name the page AND the scope: the default is almost always written at the
 * organization scope, which is where the onboarding seed lands it (#7556).
 */
import { describe, expect, it } from "vitest";

import { ModelNotConfiguredError } from "../modelNotConfiguredError";

describe("given a feature whose model cannot be resolved at any scope", () => {
  describe("when the refusal is raised", () => {
    const error = () =>
      new ModelNotConfiguredError(
        "analytics.topic_clustering_embeddings",
        "EMBEDDINGS",
        "Topic clustering embeddings",
        "project_abc",
      );

    /** @scenario The missing-model refusal names the settings page that fixes it */
    it("names the Default Models page, the organization scope and the documentation", () => {
      const raised = error();

      expect(raised.code).toBe("model_not_configured");
      expect(raised.tips?.some((tip) => tip.includes("Default Models"))).toBe(
        true,
      );
      expect(
        raised.tips?.some((tip) => tip.includes("organization scope")),
      ).toBe(true);
      expect(raised.docsUrl).toContain("/platform/model-providers");
    });

    it("keeps the role and the feature on meta so the tip can point at them", () => {
      const raised = error();

      expect(raised.meta.role).toBe("EMBEDDINGS");
      expect(raised.meta.featureKey).toBe(
        "analytics.topic_clustering_embeddings",
      );
    });
  });
});
