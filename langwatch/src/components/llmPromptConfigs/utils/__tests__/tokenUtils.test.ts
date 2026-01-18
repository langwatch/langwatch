import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL } from "~/utils/constants";
import type { ModelMetadataForFrontend } from "~/hooks/useModelProvidersSettings";
import { parameterRegistry } from "../../parameterRegistry";
import {
  buildModelChangeValues,
  calculateSensibleDefaults,
  normalizeMaxTokens,
} from "../tokenUtils";

describe("buildModelChangeValues", () => {
  describe("when called with a model name", () => {
    it("returns the model name in the result", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL);
      expect(result.model).toBe(DEFAULT_MODEL);
    });

    it("handles full model paths", () => {
      const result = buildModelChangeValues("openai/gpt-4.1");
      expect(result.model).toBe("openai/gpt-4.1");
    });

    it("handles empty string model", () => {
      const result = buildModelChangeValues("");
      expect(result.model).toBe("");
    });
  });

  describe("when setting slider parameter defaults", () => {
    it("sets temperature to registry default (1)", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL);
      expect(result.temperature).toBe(1);
    });

    it("sets topP to registry default (1)", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL) as Record<string, unknown>;
      expect(result.topP).toBe(1);
    });

    it("sets frequencyPenalty to registry default (0)", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL) as Record<string, unknown>;
      expect(result.frequencyPenalty).toBe(0);
    });

    it("sets presencePenalty to registry default (0)", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL) as Record<string, unknown>;
      expect(result.presencePenalty).toBe(0);
    });

    it("sets seed to registry default (0)", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL);
      expect(result.seed).toBe(0);
    });

    it("leaves maxTokens undefined without model metadata", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL);
      expect(result.maxTokens).toBeUndefined();
    });
  });

  describe("when setting select parameter defaults", () => {
    it("sets reasoning to registry default (medium)", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL);
      expect(result.reasoning).toBe("medium");
    });

    it("sets verbosity to registry default (medium)", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL);
      expect(result.verbosity).toBe("medium");
    });
  });

  describe("when clearing snake_case variants", () => {
    it("explicitly sets max_tokens key to undefined", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL);
      expect(result.max_tokens).toBeUndefined();
    });

    it("includes max_tokens key in result", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL);
      expect(Object.hasOwn(result, "max_tokens")).toBe(true);
    });
  });

  describe("when staying in sync with parameterRegistry", () => {
    it("includes all registered parameters in result", () => {
      const result = buildModelChangeValues(DEFAULT_MODEL);
      const registeredParams = parameterRegistry.getAllNames();

      for (const param of registeredParams) {
        expect(Object.hasOwn(result, param)).toBe(true);
      }
    });
  });

  describe("when model metadata is provided", () => {
    it("calculates maxTokens from maxCompletionTokens", () => {
      const metadata = { maxCompletionTokens: 16384 } as ModelMetadataForFrontend;
      const result = buildModelChangeValues("openai/gpt-4.1", undefined, metadata);
      expect(result.maxTokens).toBe(4096); // 16384 * 0.25 = 4096
    });

    it("caps maxTokens at registry default for large models", () => {
      const metadata = { maxCompletionTokens: 100000 } as ModelMetadataForFrontend;
      const result = buildModelChangeValues("openai/gpt-4.1", undefined, metadata);
      expect(result.maxTokens).toBe(4096); // 100000 * 0.25 = 25000, capped at 4096
    });

    it("uses contextLength when maxCompletionTokens not available", () => {
      const metadata = { contextLength: 8192 } as ModelMetadataForFrontend;
      const result = buildModelChangeValues("openai/gpt-4.1", undefined, metadata);
      expect(result.maxTokens).toBe(2048); // 8192 * 0.25 = 2048
    });
  });
});

describe("normalizeMaxTokens", () => {
  describe("when maxTokens key exists", () => {
    it("uses camelCase even if value is undefined", () => {
      const values = { model: DEFAULT_MODEL, maxTokens: undefined };
      const result = normalizeMaxTokens(values, 8000);
      expect(result.maxTokens).toBe(8000);
    });

    it("does not include max_tokens key", () => {
      const values = { model: DEFAULT_MODEL, maxTokens: undefined };
      const result = normalizeMaxTokens(values, 8000);
      expect(Object.hasOwn(result, "max_tokens")).toBe(false);
    });
  });

  describe("when max_tokens key exists", () => {
    it("uses snake_case", () => {
      const values = { model: DEFAULT_MODEL, max_tokens: 4096 };
      const result = normalizeMaxTokens(values, 8000);
      expect(result.max_tokens).toBe(8000);
    });

    it("does not include maxTokens key", () => {
      const values = { model: DEFAULT_MODEL, max_tokens: 4096 };
      const result = normalizeMaxTokens(values, 8000);
      expect(Object.hasOwn(result, "maxTokens")).toBe(false);
    });
  });

  describe("when neither key exists", () => {
    it("defaults to snake_case", () => {
      const values = { model: DEFAULT_MODEL };
      const result = normalizeMaxTokens(values, 8000);
      expect(result.max_tokens).toBe(8000);
    });
  });

  describe("when integrating with buildModelChangeValues", () => {
    it("preserves maxTokens from model change", () => {
      const afterModelChange = buildModelChangeValues(DEFAULT_MODEL);
      const afterTokenUpdate = normalizeMaxTokens(afterModelChange, 8000);
      expect(afterTokenUpdate.maxTokens).toBe(8000);
    });

    it("preserves model from model change", () => {
      const afterModelChange = buildModelChangeValues(DEFAULT_MODEL);
      const afterTokenUpdate = normalizeMaxTokens(afterModelChange, 8000);
      expect(afterTokenUpdate.model).toBe(DEFAULT_MODEL);
    });
  });
});

describe("calculateSensibleDefaults", () => {
  describe("when called without metadata", () => {
    it("returns temperature default (1)", () => {
      const defaults = calculateSensibleDefaults(undefined);
      expect(defaults.temperature).toBe(1);
    });

    it("returns topP default (1)", () => {
      const defaults = calculateSensibleDefaults(undefined);
      expect(defaults.topP).toBe(1);
    });

    it("returns frequencyPenalty default (0)", () => {
      const defaults = calculateSensibleDefaults(undefined);
      expect(defaults.frequencyPenalty).toBe(0);
    });

    it("returns presencePenalty default (0)", () => {
      const defaults = calculateSensibleDefaults(undefined);
      expect(defaults.presencePenalty).toBe(0);
    });

    it("returns seed default (0)", () => {
      const defaults = calculateSensibleDefaults(undefined);
      expect(defaults.seed).toBe(0);
    });

    it("returns reasoning default (medium)", () => {
      const defaults = calculateSensibleDefaults(undefined);
      expect(defaults.reasoning).toBe("medium");
    });

    it("returns verbosity default (medium)", () => {
      const defaults = calculateSensibleDefaults(undefined);
      expect(defaults.verbosity).toBe("medium");
    });

    it("returns undefined for maxTokens", () => {
      const defaults = calculateSensibleDefaults(undefined);
      expect(defaults.maxTokens).toBeUndefined();
    });
  });

  describe("when called with model metadata", () => {
    it("calculates maxTokens from maxCompletionTokens", () => {
      const metadata = { maxCompletionTokens: 16384 } as ModelMetadataForFrontend;
      const defaults = calculateSensibleDefaults(metadata);
      expect(defaults.maxTokens).toBe(4096); // min(4096, 16384 * 0.25)
    });

    it("uses smaller value when model max is less than registry default", () => {
      const metadata = { maxCompletionTokens: 4000 } as ModelMetadataForFrontend;
      const defaults = calculateSensibleDefaults(metadata);
      expect(defaults.maxTokens).toBe(1000); // min(4096, 4000 * 0.25)
    });

    it("uses contextLength when maxCompletionTokens not available", () => {
      const metadata = { contextLength: 32000 } as ModelMetadataForFrontend;
      const defaults = calculateSensibleDefaults(metadata);
      expect(defaults.maxTokens).toBe(4096); // min(4096, 32000 * 0.25)
    });
  });
});
