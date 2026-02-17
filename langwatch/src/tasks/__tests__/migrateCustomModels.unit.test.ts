import { describe, expect, it, vi } from "vitest";
import type { CustomModelEntry } from "../../server/modelProviders/customModel.schema";

vi.mock("../../server/db", () => ({
  prisma: {},
}));

import { migrateCustomModelsRow } from "../migrateCustomModels";

/**
 * Creates a minimal row for testing the migration logic.
 * Only includes fields relevant to the migration.
 */
function buildRow({
  provider,
  customModels = null,
  customEmbeddingsModels = null,
}: {
  provider: string;
  customModels?: unknown;
  customEmbeddingsModels?: unknown;
}) {
  return {
    id: "test-id",
    provider,
    customModels: customModels as unknown,
    customEmbeddingsModels: customEmbeddingsModels as unknown,
  };
}

describe("migrateCustomModelsRow()", () => {
  // Stub registry lookup: simulate openai having "gpt-4o" and "gpt-4o-mini" as chat models,
  // and "text-embedding-3-small" as embedding model
  const registryLookup = (provider: string, mode: "chat" | "embedding") => {
    if (provider === "openai" && mode === "chat") {
      return [
        { value: "gpt-4o", label: "gpt-4o" },
        { value: "gpt-4o-mini", label: "gpt-4o-mini" },
      ];
    }
    if (provider === "openai" && mode === "embedding") {
      return [
        {
          value: "text-embedding-3-small",
          label: "text-embedding-3-small",
        },
      ];
    }
    return [];
  };

  describe("when all custom models match registry entries", () => {
    it("returns empty arrays", () => {
      const row = buildRow({
        provider: "openai",
        customModels: ["gpt-4o", "gpt-4o-mini"],
        customEmbeddingsModels: ["text-embedding-3-small"],
      });

      const result = migrateCustomModelsRow({ row, registryLookup });

      expect(result).not.toBeNull();
      expect(result!.customModels).toEqual([]);
      expect(result!.customEmbeddingsModels).toEqual([]);
    });
  });

  describe("when custom models contain a mix of registry and non-registry entries", () => {
    it("drops registry models and converts non-registry to CustomModelEntry objects", () => {
      const row = buildRow({
        provider: "openai",
        customModels: ["gpt-4o", "ft:gpt-4o:my-org:custom:abc123"],
        customEmbeddingsModels: [
          "text-embedding-3-small",
          "my-custom-embedding",
        ],
      });

      const result = migrateCustomModelsRow({ row, registryLookup });

      expect(result).not.toBeNull();
      expect(result!.customModels).toEqual([
        {
          modelId: "ft:gpt-4o:my-org:custom:abc123",
          displayName: "ft:gpt-4o:my-org:custom:abc123",
          mode: "chat",
          maxTokens: null,
          supportedParameters: [
            "temperature",
            "top_p",
            "frequency_penalty",
            "presence_penalty",
          ],
        },
      ]);
      expect(result!.customEmbeddingsModels).toEqual([
        {
          modelId: "my-custom-embedding",
          displayName: "my-custom-embedding",
          mode: "embedding",
          maxTokens: null,
          supportedParameters: [],
        },
      ]);
    });
  });

  describe("when data is already migrated (object format)", () => {
    it("returns null to indicate no update needed", () => {
      const alreadyMigrated: CustomModelEntry[] = [
        {
          modelId: "ft:gpt-4o:my-org:custom:abc123",
          displayName: "My Fine-tune",
          mode: "chat",
          maxTokens: 4096,
          supportedParameters: ["temperature"],
          multimodalInputs: ["image"],
        },
      ];

      const row = buildRow({
        provider: "openai",
        customModels: alreadyMigrated,
        customEmbeddingsModels: [],
      });

      const result = migrateCustomModelsRow({ row, registryLookup });

      expect(result).toBeNull();
    });
  });

  describe("when custom models arrays are empty", () => {
    it("returns null (no update needed)", () => {
      const row = buildRow({
        provider: "openai",
        customModels: [],
        customEmbeddingsModels: [],
      });

      const result = migrateCustomModelsRow({ row, registryLookup });

      expect(result).toBeNull();
    });
  });

  describe("when custom models values are null", () => {
    it("returns null (no update needed)", () => {
      const row = buildRow({
        provider: "openai",
        customModels: null,
        customEmbeddingsModels: null,
      });

      const result = migrateCustomModelsRow({ row, registryLookup });

      expect(result).toBeNull();
    });
  });

  describe("when only customModels has legacy strings", () => {
    it("migrates customModels and leaves customEmbeddingsModels unchanged", () => {
      const row = buildRow({
        provider: "openai",
        customModels: ["my-custom-chat-model"],
        customEmbeddingsModels: null,
      });

      const result = migrateCustomModelsRow({ row, registryLookup });

      expect(result).not.toBeNull();
      expect(result!.customModels).toEqual([
        {
          modelId: "my-custom-chat-model",
          displayName: "my-custom-chat-model",
          mode: "chat",
          maxTokens: null,
          supportedParameters: [
            "temperature",
            "top_p",
            "frequency_penalty",
            "presence_penalty",
          ],
        },
      ]);
      expect(result!.customEmbeddingsModels).toBeNull();
    });
  });

  describe("when only customEmbeddingsModels has legacy strings", () => {
    it("migrates customEmbeddingsModels and leaves customModels unchanged", () => {
      const row = buildRow({
        provider: "openai",
        customModels: null,
        customEmbeddingsModels: ["my-custom-embedding"],
      });

      const result = migrateCustomModelsRow({ row, registryLookup });

      expect(result).not.toBeNull();
      expect(result!.customModels).toBeNull();
      expect(result!.customEmbeddingsModels).toEqual([
        {
          modelId: "my-custom-embedding",
          displayName: "my-custom-embedding",
          mode: "embedding",
          maxTokens: null,
          supportedParameters: [],
        },
      ]);
    });
  });

  describe("when provider has no registry models", () => {
    it("converts all models to CustomModelEntry objects", () => {
      const row = buildRow({
        provider: "custom",
        customModels: ["my-vllm-model", "my-other-model"],
      });

      const result = migrateCustomModelsRow({ row, registryLookup });

      expect(result).not.toBeNull();
      expect(result!.customModels).toHaveLength(2);
      expect(result!.customModels![0]!.modelId).toBe("my-vllm-model");
      expect(result!.customModels![1]!.modelId).toBe("my-other-model");
    });
  });

  describe("when one field is already migrated and other is legacy", () => {
    it("migrates only the legacy field", () => {
      const alreadyMigrated: CustomModelEntry[] = [
        {
          modelId: "already-migrated",
          displayName: "Already Migrated",
          mode: "chat",
        },
      ];

      const row = buildRow({
        provider: "openai",
        customModels: alreadyMigrated,
        customEmbeddingsModels: ["my-custom-embedding"],
      });

      const result = migrateCustomModelsRow({ row, registryLookup });

      expect(result).not.toBeNull();
      // customModels is already migrated, should be left as-is
      expect(result!.customModels).toBeNull();
      expect(result!.customEmbeddingsModels).toEqual([
        {
          modelId: "my-custom-embedding",
          displayName: "my-custom-embedding",
          mode: "embedding",
          maxTokens: null,
          supportedParameters: [],
        },
      ]);
    });
  });
});
