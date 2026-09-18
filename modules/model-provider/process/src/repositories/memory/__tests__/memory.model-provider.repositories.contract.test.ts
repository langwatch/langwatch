import { describe, expect, it } from "vitest";
import type { ModelProvider } from "@langwatch/model-provider-contract";
import { MemoryModelProviderRepositories } from "../memory.model-provider.repositories.ts";
import { MemoryRoutingHandleConflictError } from "../memory.model-provider.repository.ts";

const ORGANIZATION = "org_1";
const PROJECT_SCOPE = { scopeType: "PROJECT" as const, scopeId: "project_1" };
const ORGANIZATION_SCOPE = { scopeType: "ORGANIZATION" as const, scopeId: ORGANIZATION };

function provider(overrides: Partial<ModelProvider> & Pick<ModelProvider, "id">): ModelProvider {
  return {
    organizationId: ORGANIZATION,
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    routingHandle: null,
    scopes: [PROJECT_SCOPE],
    customKeys: null,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("given the memory model-provider repositories", () => {
  describe("when a provider row is written and read back", () => {
    it("lists the project's rows oldest first and hides another project's", async () => {
      const repositories = MemoryModelProviderRepositories.create();
      await repositories.providers.create(
        provider({ id: "mp_2", createdAt: new Date("2026-02-01T00:00:00.000Z") }),
      );
      await repositories.providers.create(provider({ id: "mp_1" }));
      await repositories.providers.create(
        provider({ id: "mp_other", scopes: [{ scopeType: "PROJECT", scopeId: "project_2" }] }),
      );

      const rows = await repositories.providers.listForProject([PROJECT_SCOPE]);

      expect(rows.map((row) => row.id)).toEqual(["mp_1", "mp_2"]);
    });

    it("refuses a row outside the scopes it was asked for", async () => {
      const repositories = MemoryModelProviderRepositories.create();
      await repositories.providers.create(provider({ id: "mp_1" }));

      const found = await repositories.providers.tryFindById({
        id: "mp_1",
        projectScopes: [{ scopeType: "PROJECT", scopeId: "project_2" }],
      });

      expect(found).toBeNull();
    });

    it("reports a stored credential only once one is written", async () => {
      const repositories = MemoryModelProviderRepositories.create();
      await repositories.providers.create(provider({ id: "mp_1" }));
      expect(await repositories.providers.hasStoredCredentials("mp_1")).toBe(false);

      await repositories.providers.update(
        provider({ id: "mp_1", customKeys: { OPENAI_API_KEY: "sk-live" } }),
      );

      expect(await repositories.providers.hasStoredCredentials("mp_1")).toBe(true);
    });
  });

  describe("when two rows claim one routing handle", () => {
    it("refuses the second and recognises the refusal as a handle conflict", async () => {
      const repositories = MemoryModelProviderRepositories.create();
      await repositories.providers.create(provider({ id: "mp_1", routingHandle: "fast" }));

      const conflict = await repositories.providers
        .create(provider({ id: "mp_2", provider: "anthropic", routingHandle: "fast" }))
        .catch((error: unknown) => error);

      expect(conflict).toBeInstanceOf(MemoryRoutingHandleConflictError);
      expect(repositories.providers.isRoutingHandleConflict(conflict)).toBe(true);
    });
  });

  describe("when a default config takes a scope another config holds", () => {
    it("detaches the scope and deletes the config left holding nothing", async () => {
      const repositories = MemoryModelProviderRepositories.create();
      await repositories.defaults.save({
        id: "mdc_1",
        organizationId: ORGANIZATION,
        config: { DEFAULT: "openai/gpt-5-mini" },
        scopes: [PROJECT_SCOPE],
        authorId: "user_1",
      });

      await repositories.defaults.save({
        id: "mdc_2",
        organizationId: ORGANIZATION,
        config: { DEFAULT: "openai/gpt-5" },
        scopes: [PROJECT_SCOPE],
        authorId: "user_1",
      });

      expect(await repositories.defaults.tryGetById("mdc_1")).toBeNull();
      expect((await repositories.defaults.tryFindByScope(PROJECT_SCOPE))?.id).toBe("mdc_2");
    });
  });

  describe("when the last key of a default config is cleared", () => {
    it("removes the config rather than leaving an empty one on the scope", async () => {
      const repositories = MemoryModelProviderRepositories.create();
      await repositories.defaults.set({
        id: "mdc_1",
        organizationId: ORGANIZATION,
        scope: ORGANIZATION_SCOPE,
        key: "FAST",
        model: "openai/gpt-5-mini",
        authorId: "user_1",
      });

      await repositories.defaults.set({
        id: "mdc_1",
        organizationId: ORGANIZATION,
        scope: ORGANIZATION_SCOPE,
        key: "FAST",
        model: null,
        authorId: "user_1",
      });

      expect(await repositories.defaults.tryFindByScope(ORGANIZATION_SCOPE)).toBeNull();
    });
  });

  describe("when the setup checklist asks whether a provider is attached", () => {
    it("counts only enabled rows on the project's own scopes", async () => {
      const repositories = MemoryModelProviderRepositories.create();
      await repositories.providers.create(provider({ id: "mp_1", enabled: false }));
      expect(await repositories.evidence.hasEnabledForScopes([PROJECT_SCOPE])).toBe(false);

      await repositories.providers.update(provider({ id: "mp_1", enabled: true }));

      expect(await repositories.evidence.hasEnabledForScopes([PROJECT_SCOPE])).toBe(true);
      expect(await repositories.evidence.hasEnabledForScopes([])).toBe(false);
    });
  });

  describe("when cost rules are listed for a project", () => {
    it("puts the project's own rate ahead of the organization's", async () => {
      const repositories = MemoryModelProviderRepositories.create();
      const base = {
        organizationId: ORGANIZATION,
        model: "gpt-5-mini",
        regex: "gpt-5-mini",
        inputCostPerToken: 1,
        outputCostPerToken: 2,
        cacheReadCostPerToken: null,
        cacheCreationCostPerToken: null,
        cacheCreation1hCostPerToken: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      };
      await repositories.costs.save({
        ...base,
        id: "cost_org",
        projectId: null,
        scopeType: "ORGANIZATION",
        scopeId: ORGANIZATION,
      });
      await repositories.costs.save({
        ...base,
        id: "cost_project",
        projectId: "project_1",
        scopeType: "PROJECT",
        scopeId: "project_1",
      });

      const rows = await repositories.costs.listForProject([PROJECT_SCOPE, ORGANIZATION_SCOPE]);

      expect(rows.map((row) => row.id)).toEqual(["cost_project", "cost_org"]);
    });
  });
});
