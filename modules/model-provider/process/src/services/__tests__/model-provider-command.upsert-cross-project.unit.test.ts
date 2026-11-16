// The settings list shows every provider of the organization, but the drawer anchors the save on
// the page's project. A provider of another project must save without moving, and only for
// someone who can write the scopes it already lives in.

import { HandledError } from "@langwatch/handled-error";
import type { ModelDefaultScope, ModelProvider } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { MemoryModelProviderDatabase } from "../../repositories/memory/memory.model-provider.database.ts";
import { MemoryModelProviderRepository } from "../../repositories/memory/memory.model-provider.repository.ts";
import { ModelProviderCommandService } from "../model-provider-command.service.ts";
import { ModelProviderKeysService } from "../model-provider-keys.service.ts";
import { ModelProviderWriteAuthorizationService } from "../model-provider-write-authorization.service.ts";

const PROJECT_A = { scopeType: "PROJECT", scopeId: "project-a" } as const;
const PROJECT_B = { scopeType: "PROJECT", scopeId: "project-b" } as const;
const ORGANIZATION_OF: Record<string, string> = {
  "project-a": "organization-1",
  "project-b": "organization-1",
  "project-x": "organization-2",
};

function storedProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  return {
    id: "provider-a",
    organizationId: "organization-1",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    routingHandle: null,
    scopes: [PROJECT_A],
    customKeys: null,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function serviceWith({ stored, writable }: { stored: ModelProvider; writable: string[] }) {
  const database = MemoryModelProviderDatabase.create();
  database.providers.set(stored.id, stored);
  const scopes = {
    getProjectScopes: async (projectId: string): Promise<ModelDefaultScope[]> => [
      { scopeType: "PROJECT", scopeId: projectId },
      { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_OF[projectId]! },
    ],
    getAnchorOrganizationId: async (input: { projectId?: string; organizationId?: string }) =>
      input.organizationId ?? ORGANIZATION_OF[input.projectId ?? ""]!,
    getOrganizationIdForScopes: async (list: ModelDefaultScope[]) =>
      ORGANIZATION_OF[list[0]!.scopeId]!,
  };
  const authorization = {
    canWrite: async (_actorId: string, scope: ModelDefaultScope) =>
      writable.includes(scope.scopeId),
  };

  return {
    database,
    service: ModelProviderCommandService.create({
      repository: MemoryModelProviderRepository.create({ database }),
      scopes,
      catalog: { exists: () => true, pickProviderDeprecation: () => null },
      ids: { generate: () => "generated-id" },
      onboardingDefaults: { seed: async () => {} },
      credentialPolicy: ModelProviderKeysService.create(),
      writeAuthorization: ModelProviderWriteAuthorizationService.create(authorization as never),
    } as never),
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : "unhandled";
  }
}

describe("ModelProviderCommandService.upsert — a provider of another project", () => {
  describe("given a provider attached only to project A", () => {
    describe("when someone who can write project A saves it from project B", () => {
      /** @scenario "A provider of another project is saved from the page's project" */
      it("saves it and leaves it attached to project A only", async () => {
        const { service, database } = serviceWith({
          stored: storedProvider(),
          writable: ["project-a", "project-b"],
        });

        await service.upsert({
          id: "provider-a",
          projectId: "project-b",
          organizationId: "organization-1",
          provider: "openai",
          name: "Renamed",
          enabled: true,
          scopes: [PROJECT_A],
          actorId: "user-1",
        });

        expect(database.providers.get("provider-a")?.name).toBe("Renamed");
        expect(database.providers.get("provider-a")?.scopes).toEqual([PROJECT_A]);
      });

      it("saves it for someone who can write project A only", async () => {
        const { service, database } = serviceWith({
          stored: storedProvider(),
          writable: ["project-a"],
        });

        await service.upsert({
          id: "provider-a",
          projectId: "project-b",
          provider: "openai",
          name: "Renamed",
          enabled: true,
          scopes: [PROJECT_A],
          actorId: "user-1",
        });

        expect(database.providers.get("provider-a")?.name).toBe("Renamed");
      });
    });

    describe("when it is saved from project B without naming any scopes", () => {
      /** @scenario "Saving a provider without scopes keeps the scopes it already has" */
      it("keeps it attached to project A only, never moving it to project B", async () => {
        const { service, database } = serviceWith({
          stored: storedProvider(),
          writable: ["project-a", "project-b"],
        });

        await service.upsert({
          id: "provider-a",
          projectId: "project-b",
          provider: "openai",
          name: "Renamed",
          enabled: true,
          actorId: "user-1",
        });

        expect(database.providers.get("provider-a")?.scopes).toEqual([PROJECT_A]);
      });
    });

    describe("when someone who can write project B but not project A saves it", () => {
      /** @scenario "A provider of another project is not saved by someone who cannot write that project" */
      it("refuses the save and leaves the provider unchanged", async () => {
        const stored = storedProvider();
        const { service, database } = serviceWith({ stored, writable: ["project-b"] });

        const code = await codeOf(
          service.upsert({
            id: "provider-a",
            projectId: "project-b",
            provider: "openai",
            name: "Renamed",
            enabled: true,
            scopes: [PROJECT_B],
            actorId: "user-1",
          }),
        );

        expect(code).toBe("model_provider_scope_forbidden");
        expect(database.providers.get("provider-a")).toEqual(stored);
      });

      it("refuses the save when no scopes are named either", async () => {
        const stored = storedProvider();
        const { service, database } = serviceWith({ stored, writable: ["project-b"] });

        const code = await codeOf(
          service.upsert({
            id: "provider-a",
            projectId: "project-b",
            provider: "openai",
            enabled: true,
            actorId: "user-1",
          }),
        );

        expect(code).toBe("model_provider_scope_forbidden");
        expect(database.providers.get("provider-a")).toEqual(stored);
      });
    });

    describe("when the save also sets the page project's default model", () => {
      it("asks for write on the page's project too, since the default lands there", async () => {
        const { service } = serviceWith({ stored: storedProvider(), writable: ["project-a"] });

        const code = await codeOf(
          service.upsert({
            id: "provider-a",
            projectId: "project-b",
            provider: "openai",
            enabled: true,
            defaultModel: "openai/gpt-5-mini",
            actorId: "user-1",
          }),
        );

        expect(code).toBe("model_provider_scope_forbidden");
      });
    });

    describe("when the save carries no actor, as the project key's own write does", () => {
      it("still finds the provider only through the page project's scopes", async () => {
        const { service } = serviceWith({
          stored: storedProvider(),
          writable: [],
        });

        const code = await codeOf(
          service.upsert({
            id: "provider-a",
            projectId: "project-b",
            provider: "openai",
            enabled: true,
          }),
        );

        expect(code).toBe("model_provider_not_found");
      });
    });
  });

  describe("given a provider of another organization", () => {
    describe("when it is saved from project B", () => {
      /** @scenario "A provider of another organization is not found from the page's project" */
      it("refuses the save as not found", async () => {
        const { service } = serviceWith({
          stored: storedProvider({
            organizationId: "organization-2",
            scopes: [{ scopeType: "PROJECT", scopeId: "project-x" }],
          }),
          writable: ["project-a", "project-b", "project-x"],
        });

        const code = await codeOf(
          service.upsert({
            id: "provider-a",
            projectId: "project-b",
            provider: "openai",
            enabled: true,
            actorId: "user-1",
          }),
        );

        expect(code).toBe("model_provider_not_found");
      });
    });
  });
});
