import { describe, expect, it } from "vitest";

import { lookUpMappedDeployment } from "../model-provider-registry.ts";

describe("lookUpMappedDeployment", () => {
  describe("when the mapping is keyed by the bare model id", () => {
    it("names that deployment", () => {
      expect(
        lookUpMappedDeployment({
          deploymentMapping: { "gpt-4o": "acme-prod" },
          qualifiedModel: "azure/gpt-4o",
        }),
      ).toEqual({ kind: "mapped", deployment: "acme-prod" });
    });
  });

  describe("when the mapping is keyed by the provider-qualified id", () => {
    it("names that deployment", () => {
      expect(
        lookUpMappedDeployment({
          deploymentMapping: { "azure/gpt-4o": "acme-prod" },
          qualifiedModel: "azure/gpt-4o",
        }),
      ).toEqual({ kind: "mapped", deployment: "acme-prod" });
    });
  });

  describe("when both keys are present", () => {
    it("prefers the bare key", () => {
      expect(
        lookUpMappedDeployment({
          deploymentMapping: { "gpt-4o": "acme-bare", "azure/gpt-4o": "acme-qualified" },
          qualifiedModel: "azure/gpt-4o",
        }),
      ).toEqual({ kind: "mapped", deployment: "acme-bare" });
    });
  });

  describe("when nothing maps the model", () => {
    it("says it is unmapped", () => {
      expect(
        lookUpMappedDeployment({ deploymentMapping: null, qualifiedModel: "azure/gpt-4o" }),
      ).toEqual({ kind: "unmapped" });
      expect(
        lookUpMappedDeployment({
          deploymentMapping: { other: "x" },
          qualifiedModel: "azure/gpt-4o",
        }),
      ).toEqual({ kind: "unmapped" });
    });
  });
});
