import { describe, expect, it } from "vitest";

import {
  buildScopeHierarchy,
  firstEligibleDefaultModel,
  type OrgModelProvider,
  resolveEligible,
  resolveProviderDefaultModel,
} from "../model/eligible-model-providers";

describe("resolveProviderDefaultModel", () => {
  describe("when the provider is a self-hosted custom endpoint", () => {
    it("uses the first custom model in resolver-safe vendor/model form", () => {
      expect(
        resolveProviderDefaultModel("custom", "Custom", [], [{ modelId: "Qwen2.5-0.5B-Instruct" }]),
      ).toBe("custom/Qwen2.5-0.5B-Instruct");
    });

    it("does not fall back to the OpenAI-only gpt-5-mini", () => {
      expect(
        resolveProviderDefaultModel("custom", "Custom", [], [{ modelId: "Qwen2.5-0.5B-Instruct" }]),
      ).not.toContain("gpt-5-mini");
    });

    it("prefers a registry chat model over a custom model when both exist", () => {
      expect(
        resolveProviderDefaultModel(
          "custom",
          "Custom",
          ["llama-3"],
          [{ modelId: "Qwen2.5-0.5B-Instruct" }],
        ),
      ).toBe("custom/llama-3");
    });
  });

  describe("when the provider is a first-class registry provider", () => {
    it("prefixes the registry default with the provider key", () => {
      const result = resolveProviderDefaultModel("openai", "OpenAI", []);
      expect(result.startsWith("openai/")).toBe(true);
    });
  });

  describe("when no model can be resolved", () => {
    it("returns the bare provider label so the gateway surfaces a readable error", () => {
      expect(resolveProviderDefaultModel("custom", "My vLLM", [])).toBe("my vllm");
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
  const hierarchy = buildScopeHierarchy([{ id: PROJECT_ID, teamId: TEAM_ID }], ORG_ID);
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
      const [row] = resolveEligible({
        scopes: keyAtProject,
        providers: [orgProvider],
        hierarchy,
      });

      expect(row?.definedAt).toEqual({
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      });
    });
  });

  describe("when the provider is attached at every tier the key reaches", () => {
    /** @scenario A provider reachable through several tiers is attributed to the broadest one */
    it("attributes it to the broadest tier", () => {
      const [row] = resolveEligible({
        scopes: keyAtProject,
        providers: [
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
      });

      expect(row?.definedAt).toEqual({
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      });
    });

    /** @scenario The same provider is never listed twice */
    it("returns it once", () => {
      expect(
        resolveEligible({
          scopes: keyAtProject,
          providers: [
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
        }),
      ).toHaveLength(1);
    });
  });

  describe("when a provider in scope has been switched off", () => {
    /** @scenario A provider an admin turned off is not offered to a new key */
    it("leaves it out", () => {
      expect(
        resolveEligible({
          scopes: keyAtProject,
          providers: [{ ...orgProvider, enabled: false }],
          hierarchy,
        }),
      ).toEqual([]);
    });
  });

  describe("when a provider in scope has been withdrawn", () => {
    /** @scenario A provider an admin removed is not offered to a new key */
    it("leaves it out", () => {
      expect(
        resolveEligible({
          scopes: keyAtProject,
          providers: [{ ...orgProvider, disabledAt: new Date("2026-07-01T00:00:00Z") }],
          hierarchy,
        }),
      ).toEqual([]);
    });
  });

  describe("when a row arrives without a routability signal", () => {
    it("fails closed rather than advertising it", () => {
      const { enabled: _dropped, ...noSignal } = orgProvider;

      expect(
        resolveEligible({
          scopes: keyAtProject,
          providers: [noSignal],
          hierarchy,
        }),
      ).toEqual([]);
    });
  });

  describe("when the key carries a provider allowlist", () => {
    const secondProvider: OrgModelProvider = {
      id: "mp-project",
      name: "Team Anthropic",
      provider: "anthropic",
      enabled: true,
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      models: ["claude-sonnet-4-5"],
    };

    /** @scenario "The provider panel shows what the key may use, not what its scope reaches" */
    it("narrows the answer to the providers the key may hold", () => {
      expect(
        resolveEligible({
          scopes: keyAtProject,
          providers: [orgProvider, secondProvider],
          hierarchy,
          providersAllowed: ["mp-project"],
        }).map((p) => p.id),
      ).toEqual(["mp-project"]);
    });

    it("answers with everything in scope when the list is absent or empty", () => {
      const everything = ["mp-org", "mp-project"];
      expect(
        resolveEligible({
          scopes: keyAtProject,
          providers: [orgProvider, secondProvider],
          hierarchy,
        })
          .map((p) => p.id)
          .sort(),
      ).toEqual(everything);
      expect(
        resolveEligible({
          scopes: keyAtProject,
          providers: [orgProvider, secondProvider],
          hierarchy,
          providersAllowed: null,
        })
          .map((p) => p.id)
          .sort(),
      ).toEqual(everything);
      expect(
        resolveEligible({
          scopes: keyAtProject,
          providers: [orgProvider, secondProvider],
          hierarchy,
          providersAllowed: [],
        })
          .map((p) => p.id)
          .sort(),
      ).toEqual(everything);
    });

    it("never widens the answer past what the scopes reach", () => {
      // A provider named by the key but out of its scope stays out: the
      // allowlist narrows, it does not grant.
      expect(
        resolveEligible({
          scopes: [{ scopeType: "TEAM" as const, scopeId: TEAM_ID }],
          providers: [orgProvider, secondProvider],
          hierarchy,
          providersAllowed: ["mp-project"],
        }),
      ).toEqual([]);
    });
  });

  describe("when providers live at different scope tiers", () => {
    const mixedTierProviders: OrgModelProvider[] = [
      {
        id: "mp-org-z",
        name: "Zeta Org",
        provider: "openai",
        enabled: true,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        models: [],
      },
      {
        id: "mp-org-a",
        name: "Alpha Org",
        provider: "openai",
        enabled: true,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        models: [],
      },
      {
        id: "mp-team",
        name: "Mid Team",
        provider: "openai",
        enabled: true,
        scopes: [{ scopeType: "TEAM", scopeId: TEAM_ID }],
        models: [],
      },
      {
        id: "mp-proj",
        name: "Proj",
        provider: "openai",
        enabled: true,
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        models: [],
      },
    ];

    /** @scenario Provider access lists organization scope before team before project */
    it("lists organization first, then team, then project, by name within a scope", () => {
      const rows = resolveEligible({
        scopes: keyAtProject,
        providers: mixedTierProviders,
        hierarchy,
      });

      expect(rows.map((r) => r.label)).toEqual(["Alpha Org", "Zeta Org", "Mid Team", "Proj"]);
      expect(rows.map((r) => r.definedAt.scopeType)).toEqual([
        "ORGANIZATION",
        "ORGANIZATION",
        "TEAM",
        "PROJECT",
      ]);
    });
  });
});
