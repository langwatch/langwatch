import { describe, expect, it } from "vitest";
import {
  customModelEntrySchema,
  isLegacyCustomModels,
  toLegacyCompatibleCustomModels,
} from "../customModel.schema";

describe("customModelEntrySchema", () => {
  describe("when given a valid chat model entry", () => {
    it("accepts all required fields", () => {
      const input = {
        modelId: "gpt-5-custom",
        displayName: "GPT-5 Custom",
        mode: "chat" as const,
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(input);
    });

    it("accepts all optional fields", () => {
      const input = {
        modelId: "gpt-5-custom",
        displayName: "GPT-5 Custom",
        mode: "chat" as const,
        maxTokens: 4096,
        supportedParameters: ["temperature", "top_p"],
        multimodalInputs: ["image", "audio"],
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(input);
    });

    it("rejects unknown parameter names", () => {
      const input = {
        modelId: "my-model",
        displayName: "My Model",
        mode: "chat" as const,
        supportedParameters: ["temperature", "unknown_param"],
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects unknown multimodal input types", () => {
      const input = {
        modelId: "my-model",
        displayName: "My Model",
        mode: "chat" as const,
        multimodalInputs: ["image", "video"],
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("accepts maxTokens as null", () => {
      const input = {
        modelId: "my-model",
        displayName: "My Model",
        mode: "chat" as const,
        maxTokens: null,
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data?.maxTokens).toBeNull();
    });
  });

  describe("when given a valid embedding model entry", () => {
    it("accepts embedding mode", () => {
      const input = {
        modelId: "custom-embedding",
        displayName: "Custom Embedding",
        mode: "embedding" as const,
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(true);
      expect(result.data?.mode).toBe("embedding");
    });
  });

  describe("when given invalid input", () => {
    it("rejects empty modelId", () => {
      const input = {
        modelId: "",
        displayName: "Name",
        mode: "chat",
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects empty displayName", () => {
      const input = {
        modelId: "my-model",
        displayName: "",
        mode: "chat",
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects invalid mode", () => {
      const input = {
        modelId: "my-model",
        displayName: "My Model",
        mode: "completion",
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects negative maxTokens", () => {
      const input = {
        modelId: "my-model",
        displayName: "My Model",
        mode: "chat",
        maxTokens: -100,
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects zero maxTokens", () => {
      const input = {
        modelId: "my-model",
        displayName: "My Model",
        mode: "chat",
        maxTokens: 0,
      };

      const result = customModelEntrySchema.safeParse(input);

      expect(result.success).toBe(false);
    });

    it("rejects missing required fields", () => {
      const result = customModelEntrySchema.safeParse({});

      expect(result.success).toBe(false);
    });
  });
});

describe("isLegacyCustomModels", () => {
  describe("when given a string array", () => {
    it("returns true", () => {
      expect(isLegacyCustomModels(["model-a", "model-b"])).toBe(true);
    });

    it("returns true for empty array", () => {
      expect(isLegacyCustomModels([])).toBe(true);
    });
  });

  describe("when given an object array", () => {
    it("returns false", () => {
      const models = [
        { modelId: "model-a", displayName: "Model A", mode: "chat" as const },
      ];
      expect(isLegacyCustomModels(models)).toBe(false);
    });
  });

  describe("when given null or undefined", () => {
    it("returns false for null", () => {
      expect(isLegacyCustomModels(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isLegacyCustomModels(undefined)).toBe(false);
    });
  });
});

describe("toLegacyCompatibleCustomModels", () => {
  describe("when converting string arrays", () => {
    it("converts strings to CustomModelEntry objects for chat mode", () => {
      const result = toLegacyCompatibleCustomModels(
        ["model-a", "model-b"],
        "chat",
      );

      expect(result).toEqual([
        { modelId: "model-a", displayName: "model-a", mode: "chat" },
        { modelId: "model-b", displayName: "model-b", mode: "chat" },
      ]);
    });

    it("converts strings to CustomModelEntry objects for embedding mode", () => {
      const result = toLegacyCompatibleCustomModels(
        ["embedding-a"],
        "embedding",
      );

      expect(result).toEqual([
        {
          modelId: "embedding-a",
          displayName: "embedding-a",
          mode: "embedding",
        },
      ]);
    });

    it("returns empty array for empty input", () => {
      expect(toLegacyCompatibleCustomModels([], "chat")).toEqual([]);
    });
  });

  describe("when input is already CustomModelEntry objects", () => {
    it("returns them unchanged", () => {
      const entries = [
        { modelId: "model-a", displayName: "Model A", mode: "chat" as const },
      ];

      const result = toLegacyCompatibleCustomModels(entries, "chat");

      expect(result).toEqual(entries);
    });
  });

  describe("when input is null or undefined", () => {
    it("returns empty array for null", () => {
      expect(toLegacyCompatibleCustomModels(null, "chat")).toEqual([]);
    });

    it("returns empty array for undefined", () => {
      expect(toLegacyCompatibleCustomModels(undefined, "chat")).toEqual([]);
    });
  });
});
