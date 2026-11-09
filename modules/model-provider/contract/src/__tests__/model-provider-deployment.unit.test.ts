import { describe, expect, it } from "vitest";

import { deploymentForModel } from "../model-provider-deployment.ts";

describe("deploymentForModel", () => {
  describe("when the mapping is keyed by the bare model id", () => {
    it("names that deployment", () => {
      expect(
        deploymentForModel({
          deploymentMapping: { "gpt-4o": "acme-prod" },
          qualifiedModel: "azure/gpt-4o",
        }),
      ).toBe("acme-prod");
    });
  });

  describe("when the mapping is keyed by the provider-qualified id", () => {
    it("names that deployment", () => {
      expect(
        deploymentForModel({
          deploymentMapping: { "azure/gpt-4o": "acme-prod" },
          qualifiedModel: "azure/gpt-4o",
        }),
      ).toBe("acme-prod");
    });
  });

  describe("when both keys are present", () => {
    it("prefers the bare key", () => {
      expect(
        deploymentForModel({
          deploymentMapping: { "gpt-4o": "acme-bare", "azure/gpt-4o": "acme-qualified" },
          qualifiedModel: "azure/gpt-4o",
        }),
      ).toBe("acme-bare");
    });
  });

  describe("when nothing maps the model", () => {
    it("names no deployment", () => {
      expect(
        deploymentForModel({ deploymentMapping: null, qualifiedModel: "azure/gpt-4o" }),
      ).toBeNull();
      expect(
        deploymentForModel({ deploymentMapping: { other: "x" }, qualifiedModel: "azure/gpt-4o" }),
      ).toBeNull();
    });
  });
});
