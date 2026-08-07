import { describe, expect, it } from "vitest";

import {
  buildScopeHierarchy,
  firstEligibleDefaultModel,
  type OrgModelProvider,
  resolveEligible,
  resolveProviderDefaultModel,
} from "../eligibleModelProviders";

describe("resolveProviderDefaultModel", () => {
  describe("when the provider is a self-hosted custom endpoint", () => {
    it("uses the first custom model in resolver-safe vendor/model form", () => {
      expect(
        resolveProviderDefaultModel({
          providerKey: "custom",
          providerLabel: "Custom",
          providerModels: [],
          customModels: [{ modelId: "Qwen2.5-0.5B-Instruct" }],
        }),
      ).toBe("custom/Qwen2.5-0.5B-Instruct");
    });

    it("does not fall back to the OpenAI-only gpt-5-mini", () => {
      expect(
        resolveProviderDefaultModel({
          providerKey: "custom",
          providerLabel: "Custom",
          providerModels: [],
          customModels: [{ modelId: "Qwen2.5-0.5B-Instruct" }],
        }),
      ).not.toContain("gpt-5-mini");
    });

    it("prefers a registry chat model over a custom model when both exist", () => {
      expect(
        resolveProviderDefaultModel({
          providerKey: "custom",
          providerLabel: "Custom",
          providerModels: ["llama-3"],
          customModels: [{ modelId: "Qwen2.5-0.5B-Instruct" }],
        }),
      ).toBe("custom/llama-3");
    });
  });

  describe("when the provider is a first-class registry provider", () => {
    it("prefixes the registry default with the provider key", () => {
      const result = resolveProviderDefaultModel({
        providerKey: "openai",
        providerLabel: "OpenAI",
        providerModels: [],
      });
      expect(result.startsWith("openai/")).toBe(true);
    });
  });

  describe("when no model can be resolved", () => {
    it("returns the bare provider label so the gateway surfaces a readable error", () => {
      expect(
        resolveProviderDefaultModel({
          providerKey: "custom",
          providerLabel: "My vLLM",
          providerModels: [],
        }),
      ).toBe("my vllm");
    });
  });
});

describe("firstEligibleDefaultModel", () => {
  const customProvider: OrgModelProvider = {
    id: "mp-1",
    name: "Self-hosted vLLM",
    provider: "custom",
    enabled: true,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
    models: [],
    customModels: [{ modelId: "Qwen2.5-0.5B-Instruct" }],
  };

  describe("when a custom provider is eligible at the key's scope", () => {
    /** @scenario Usage example on the key detail page matches the key's provider */
    it("returns custom/<model> so the usage example is servable", () => {
      expect(
        firstEligibleDefaultModel({
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
          providers: [customProvider],
          availableProjects: [],
          organizationId: "org-1",
        }),
      ).toBe("custom/Qwen2.5-0.5B-Instruct");
    });
  });

  describe("when no provider is eligible at the key's scope", () => {
    it("returns undefined so the caller can fall back to a placeholder", () => {
      expect(
        firstEligibleDefaultModel({
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
          providers: [],
          availableProjects: [],
          organizationId: "org-1",
        }),
      ).toBeUndefined();
    });
  });
});

describe("resolveEligible", () => {
  const ORG_ID = "org-1";
  const TEAM_ID = "team-1";
  const PROJECT_ID = "project-1";
  const hierarchy = buildScopeHierarchy(
    [{ id: PROJECT_ID, teamId: TEAM_ID }],
    ORG_ID,
  );
  const keyAtProject = [{ scopeType: "PROJECT" as const, scopeId: PROJECT_ID }];
  const orgProvider: OrgModelProvider = {
    id: "mp-org",
    name: "Central OpenAI",
    provider: "openai",
    enabled: true,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
    models: ["gpt-5-mini"],
  };

  describe("when the provider lives at the organization and the key at a project", () => {
    /** @scenario An org-scoped provider inherited into a project is attributed to the organization */
    it("attributes the provider to the organization it is defined at", () => {
      const [row] = resolveEligible(keyAtProject, [orgProvider], hierarchy);

      expect(row?.definedAt).toEqual({
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      });
    });
  });

  describe("when the provider is attached at every tier the key reaches", () => {
    /** @scenario A provider reachable through several tiers is attributed to the broadest one */
    it("attributes it to the broadest tier", () => {
      const [row] = resolveEligible(
        keyAtProject,
        [
          {
            ...orgProvider,
            scopes: [
              { scopeType: "PROJECT", scopeId: PROJECT_ID },
              { scopeType: "TEAM", scopeId: TEAM_ID },
              { scopeType: "ORGANIZATION", scopeId: ORG_ID },
            ],
          },
        ],
        hierarchy,
      );

      expect(row?.definedAt).toEqual({
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      });
    });

    /** @scenario The same provider is never listed twice */
    it("returns it once", () => {
      expect(
        resolveEligible(
          keyAtProject,
          [
            {
              ...orgProvider,
              scopes: [
                { scopeType: "PROJECT", scopeId: PROJECT_ID },
                { scopeType: "TEAM", scopeId: TEAM_ID },
                { scopeType: "ORGANIZATION", scopeId: ORG_ID },
              ],
            },
          ],
          hierarchy,
        ),
      ).toHaveLength(1);
    });
  });

  describe("when a provider in scope has been switched off", () => {
    /** @scenario A provider an admin turned off is not offered to a new key */
    it("leaves it out", () => {
      expect(
        resolveEligible(
          keyAtProject,
          [{ ...orgProvider, enabled: false }],
          hierarchy,
        ),
      ).toEqual([]);
    });
  });

  describe("when a provider in scope has been withdrawn", () => {
    /** @scenario A provider an admin removed is not offered to a new key */
    it("leaves it out", () => {
      expect(
        resolveEligible(
          keyAtProject,
          [{ ...orgProvider, disabledAt: new Date("2026-07-01T00:00:00Z") }],
          hierarchy,
        ),
      ).toEqual([]);
    });
  });

  describe("when a row arrives without a routability signal", () => {
    it("fails closed rather than advertising it", () => {
      const { enabled: _dropped, ...noSignal } = orgProvider;

      expect(resolveEligible(keyAtProject, [noSignal], hierarchy)).toEqual([]);
    });
  });
});
