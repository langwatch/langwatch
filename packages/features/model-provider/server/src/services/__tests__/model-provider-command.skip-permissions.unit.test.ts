/**
 * The Langy skip-permissions allowlist (ADR-129) is regular-expression
 * source per line. A pattern that never compiles matches nothing, so
 * storing it would leave the operator believing a model is trusted when the
 * gate always says no — the whole save must be refused, on both the create
 * and the update path, before any database work runs.
 *
 * Only the collaborators the happy path actually touches are stubbed; the
 * rest are left unbuilt rather than stubbed into noise.
 */

import { describe, expect, it } from "vitest";
import { ModelProviderSkipPermissionsPatternInvalidError } from "@langwatch/model-provider-contract";
import { ModelProviderCommandService } from "../model-provider-command.service";

function serviceWith(
  options: {
    existing?: unknown;
  } = {},
) {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  const found: unknown[] = [];
  const repository = {
    tryFindById: async (input: unknown) => {
      found.push(input);
      return options.existing ?? null;
    },
    create: async (input: unknown) => {
      created.push(input);
      return input;
    },
    update: async (input: unknown) => {
      updated.push(input);
      return input;
    },
  };
  const scopes = {
    tryGetProjectScopes: async () => null,
    tryResolveAnchor: async () => "organization-1",
    getOrganizationIdForScopes: async () => "organization-1",
  };
  const catalog = {
    exists: () => true,
    tryGetProviderDeprecation: () => null,
  };
  const ids = {
    generate: () => "provider-1",
  };
  const onboardingDefaults = {
    seed: async () => {},
  };

  return {
    created,
    updated,
    found,
    service: ModelProviderCommandService.create({
      repository,
      scopes,
      catalog,
      ids,
      onboardingDefaults,
    } as never),
  };
}

describe("ModelProviderCommandService.upsert — skip-permissions patterns", () => {
  describe("given a pattern that does not compile", () => {
    describe("when creating a provider", () => {
      /** @scenario "The save is refused server-side even without the field" */
      it("refuses before any database work", async () => {
        const { service, created, found } = serviceWith();

        await expect(
          service.upsert({
            projectId: "project-1",
            provider: "openai",
            enabled: true,
            scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
            langySkipPermissionsModels: ["gpt-5(", "gpt-5-mini"],
          } as never),
        ).rejects.toBeInstanceOf(ModelProviderSkipPermissionsPatternInvalidError);
        expect(created).toEqual([]);
        expect(found).toEqual([]);
      });
    });

    describe("when updating an existing provider", () => {
      /** @scenario "The save is refused server-side even without the field" */
      it("refuses before any database work", async () => {
        const { service, created, found } = serviceWith();

        await expect(
          service.upsert({
            id: "provider-1",
            projectId: "project-1",
            provider: "openai",
            enabled: true,
            langySkipPermissionsModels: ["gpt-5-mini", "(unterminated"],
          } as never),
        ).rejects.toBeInstanceOf(ModelProviderSkipPermissionsPatternInvalidError);
        expect(created).toEqual([]);
        // The check runs before the existing row is even looked up.
        expect(found).toEqual([]);
      });
    });
  });

  describe("given a list of patterns that all compile", () => {
    describe("when creating a provider", () => {
      /** @scenario "The save is refused server-side even without the field" */
      it("saves normally", async () => {
        const { service, created } = serviceWith();

        await service.upsert({
          projectId: "project-1",
          provider: "openai",
          enabled: true,
          scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
          langySkipPermissionsModels: ["gpt-5.*", "^claude-opus-5"],
        } as never);

        expect(created).toHaveLength(1);
      });
    });
  });
});

describe("ModelProviderCommandService.upsert — the list that reaches the repository", () => {
  function storedProvider(langySkipPermissionsModels: string[] | null) {
    return {
      id: "provider-1",
      organizationId: "organization-1",
      provider: "openai",
      name: "OpenAI",
      enabled: true,
      routingHandle: null,
      scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
      customKeys: null,
      customModels: [],
      customEmbeddingsModels: [],
      extraHeaders: [],
      rateLimitRpm: null,
      rateLimitTpm: null,
      rateLimitRpd: null,
      fallbackPriorityGlobal: null,
      providerConfig: null,
      langySkipPermissionsModels,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  describe("given a create naming two patterns", () => {
    describe("when the provider is saved", () => {
      /** @scenario "A stored list replaces the provider default" */
      it("writes both patterns onto the row", async () => {
        const { service, created } = serviceWith();

        await service.upsert({
          projectId: "project-1",
          provider: "openai",
          enabled: true,
          scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
          langySkipPermissionsModels: ["^gpt-9$", "^gpt-10$"],
        } as never);

        expect(
          (created[0] as { langySkipPermissionsModels: unknown }).langySkipPermissionsModels,
        ).toEqual(["^gpt-9$", "^gpt-10$"]);
      });
    });
  });

  describe("given a provider that already holds a list", () => {
    describe("when the write names an empty list", () => {
      /** @scenario "Clearing the list returns the provider to its default" */
      it("clears the row, so the registry default applies again", async () => {
        const { service, updated } = serviceWith({ existing: storedProvider(["^gpt-9$"]) });

        await service.upsert({
          id: "provider-1",
          projectId: "project-1",
          provider: "openai",
          enabled: true,
          langySkipPermissionsModels: [],
        } as never);

        expect(
          (updated[0] as { langySkipPermissionsModels: unknown }).langySkipPermissionsModels,
        ).toBeNull();
      });
    });

    describe("when the write does not name the list", () => {
      /** @scenario "A stored list replaces the provider default" */
      it("leaves the stored patterns alone", async () => {
        const { service, updated } = serviceWith({ existing: storedProvider(["^gpt-9$"]) });

        await service.upsert({
          id: "provider-1",
          projectId: "project-1",
          provider: "openai",
          enabled: false,
        } as never);

        expect(
          (updated[0] as { langySkipPermissionsModels: unknown }).langySkipPermissionsModels,
        ).toEqual(["^gpt-9$"]);
      });
    });
  });
});
