/** @see modules/model-provider/specs/model-provider.feature */
import type { ModelProvider } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { MemoryModelProviderRepositories } from "../../repositories/memory/memory.model-provider.repositories.ts";
import { createModelProviderTestApp } from "./model-provider.fixture.ts";

function providerRow(overrides: Partial<ModelProvider>): ModelProvider {
  return {
    id: "provider-1",
    organizationId: "organization-1",
    provider: "elevenlabs",
    name: "ElevenLabs",
    enabled: true,
    routingHandle: null,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: "organization-1" }],
    customKeys: { ELEVENLABS_API_KEY: "xi-invented" },
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

async function appHolding(row: ModelProvider | null) {
  const repositories = MemoryModelProviderRepositories.create();
  if (row) await repositories.providers.create(row);

  return createModelProviderTestApp({ repositories });
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  const error: unknown = await promise.then(
    () => void 0,
    (caught: unknown) => caught,
  );
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

describe("ModelProviderApp.getCustomKeys", () => {
  describe("when the row stores custom keys", () => {
    it("answers them with the row's provider and organization", async () => {
      const app = await appHolding(providerRow({}));

      await expect(app.getCustomKeys({ modelProviderId: "provider-1" })).resolves.toEqual({
        id: "provider-1",
        provider: "elevenlabs",
        organizationId: "organization-1",
        customKeys: { ELEVENLABS_API_KEY: "xi-invented" },
      });
    });
  });

  describe("when the row stores none", () => {
    it("refuses with model_provider_custom_keys_missing", async () => {
      const app = await appHolding(providerRow({ customKeys: null }));

      expect(await codeOf(app.getCustomKeys({ modelProviderId: "provider-1" }))).toBe(
        "model_provider_custom_keys_missing",
      );
    });
  });

  describe("when no row has the id", () => {
    it("refuses with model_provider_not_found", async () => {
      const app = await appHolding(null);

      expect(await codeOf(app.getCustomKeys({ modelProviderId: "provider-1" }))).toBe(
        "model_provider_not_found",
      );
    });
  });
});
