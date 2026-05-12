import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api-model-providers.js", () => ({
  listModelProviders: vi.fn(),
  setModelProvider: vi.fn(),
}));

import {
  listModelProviders,
  setModelProvider,
} from "../langwatch-api-model-providers.js";

import { handleListModelProviders } from "../tools/list-model-providers.js";
import { handleSetModelProvider } from "../tools/set-model-provider.js";

const mockListModelProviders = vi.mocked(listModelProviders);
const mockSetModelProvider = vi.mocked(setModelProvider);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleListModelProviders()", () => {
  const sampleProviders = {
    openai: {
      provider: "openai",
      enabled: true,
      customKeys: { OPENAI_API_KEY: "HAS_KEY" },
      models: ["gpt-4o", "gpt-4o-mini"],
      embeddingsModels: ["text-embedding-3-small"],
      deploymentMapping: null,
      extraHeaders: [],
    },
    anthropic: {
      provider: "anthropic",
      enabled: false,
      customKeys: null,
      models: ["claude-sonnet-4-5-20250929"],
      embeddingsModels: null,
      deploymentMapping: null,
      extraHeaders: [],
    },
  };

  describe("when providers exist", () => {
    let result: string;

    beforeEach(async () => {
      mockListModelProviders.mockResolvedValue(sampleProviders);
      result = await handleListModelProviders();
    });

    it("includes the total count header", () => {
      expect(result).toContain("# Model Providers (2 total)");
    });

    it("includes provider name", () => {
      expect(result).toContain("## openai");
    });

    it("shows enabled status", () => {
      expect(result).toContain("**Status**: enabled");
    });

    it("shows disabled status", () => {
      expect(result).toContain("**Status**: disabled");
    });

    it("shows key fields that are set", () => {
      expect(result).toContain("OPENAI_API_KEY: set");
    });

    it("shows model count", () => {
      expect(result).toContain("2 available");
    });
  });

  describe("when no providers exist", () => {
    let result: string;

    beforeEach(async () => {
      mockListModelProviders.mockResolvedValue({});
      result = await handleListModelProviders();
    });

    it("returns a no-providers message", () => {
      expect(result).toContain("No model providers configured");
    });

    it("includes a tip to use platform_set_model_provider", () => {
      expect(result).toContain("platform_set_model_provider");
    });
  });
});

describe("handleSetModelProvider()", () => {
  describe("when update succeeds", () => {
    let result: string;

    beforeEach(async () => {
      mockSetModelProvider.mockResolvedValue({
        openai: {
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: "HAS_KEY" },
          models: ["gpt-4o"],
          embeddingsModels: null,
          deploymentMapping: null,
          extraHeaders: [],
        },
      });
      result = await handleSetModelProvider({
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: "sk-test123" },
      });
    });

    it("confirms update", () => {
      expect(result).toContain("Model provider updated successfully!");
    });

    it("includes provider name", () => {
      expect(result).toContain("**Provider**: openai");
    });

    it("shows enabled status", () => {
      expect(result).toContain("**Status**: enabled");
    });

    it("shows key fields", () => {
      expect(result).toContain("OPENAI_API_KEY: set");
    });
  });

  describe("when setting default model without provider prefix", () => {
    let result: string;

    beforeEach(async () => {
      mockSetModelProvider.mockResolvedValue({
        openai: {
          provider: "openai",
          enabled: true,
          customKeys: null,
          models: ["gpt-4o"],
          embeddingsModels: null,
          deploymentMapping: null,
          extraHeaders: [],
        },
      });
      result = await handleSetModelProvider({
        provider: "openai",
        enabled: true,
        defaultModel: "gpt-4o",
      });
    });

    it("prepends provider prefix in response", () => {
      expect(result).toContain("**Default Model**: openai/gpt-4o");
    });
  });

  describe("when setting default model with provider prefix already", () => {
    let result: string;

    beforeEach(async () => {
      mockSetModelProvider.mockResolvedValue({
        openai: {
          provider: "openai",
          enabled: true,
          customKeys: null,
          models: ["gpt-4o"],
          embeddingsModels: null,
          deploymentMapping: null,
          extraHeaders: [],
        },
      });
      result = await handleSetModelProvider({
        provider: "openai",
        enabled: true,
        defaultModel: "openai/gpt-4o",
      });
    });

    it("keeps the prefix as-is", () => {
      expect(result).toContain("**Default Model**: openai/gpt-4o");
      expect(result).not.toContain("openai/openai/");
    });
  });
});
