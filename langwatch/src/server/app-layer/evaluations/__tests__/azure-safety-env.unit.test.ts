/**
 * Unit tests for getAzureSafetyEnvFromProject.
 *
 * Covers @integration scenarios from specs/evaluators/azure-safety-byok-gating.feature:
 * - "availableEvaluators reports missing env vars for Azure when provider is absent"
 * - "availableEvaluators ignores process.env for Azure evaluators"
 *
 * The helper must return null when:
 *   - no azure_safety provider exists for the project
 *   - the provider exists but is disabled
 *   - the provider exists but is missing endpoint or key
 * It must NOT fall back to process.env.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProjectModelProvidersMock } = vi.hoisted(() => ({
  getProjectModelProvidersMock: vi.fn(),
}));

vi.mock("../../../api/routers/modelProviders.utils", () => ({
  getProjectModelProviders: getProjectModelProvidersMock,
}));

import {
  AZURE_SAFETY_ENV_VARS,
  AZURE_SAFETY_NOT_CONFIGURED_MESSAGE,
  AZURE_SAFETY_PROVIDER_KEY,
  getAzureSafetyEnvFromProject,
  isAzureEvaluatorType,
} from "../azure-safety-env";

describe("azure-safety-env constants", () => {
  it("exports the provider key", () => {
    expect(AZURE_SAFETY_PROVIDER_KEY).toBe("azure_safety");
  });

  it("exports the required env vars", () => {
    expect(AZURE_SAFETY_ENV_VARS).toEqual([
      "AZURE_CONTENT_SAFETY_ENDPOINT",
      "AZURE_CONTENT_SAFETY_KEY",
    ]);
  });

  it("exports a clear not-configured message", () => {
    expect(AZURE_SAFETY_NOT_CONFIGURED_MESSAGE).toMatch(/not configured/i);
    expect(AZURE_SAFETY_NOT_CONFIGURED_MESSAGE).toMatch(/Model Providers/i);
  });
});

describe("isAzureEvaluatorType", () => {
  describe("when the evaluator type starts with azure/", () => {
    it("returns true for azure/content_safety", () => {
      expect(isAzureEvaluatorType("azure/content_safety")).toBe(true);
    });

    it("returns true for azure/prompt_injection", () => {
      expect(isAzureEvaluatorType("azure/prompt_injection")).toBe(true);
    });

    it("returns true for azure/jailbreak", () => {
      expect(isAzureEvaluatorType("azure/jailbreak")).toBe(true);
    });
  });

  describe("when the evaluator type is not azure", () => {
    it("returns false for openai/moderation", () => {
      expect(isAzureEvaluatorType("openai/moderation")).toBe(false);
    });

    it("returns false for langevals/llm_answer_match", () => {
      expect(isAzureEvaluatorType("langevals/llm_answer_match")).toBe(false);
    });
  });
});

describe("getAzureSafetyEnvFromProject", () => {
  const projectId = "project-test-1";

  beforeEach(() => {
    vi.clearAllMocks();
    // Pollute process.env to prove we don't fall back to it
    process.env.AZURE_CONTENT_SAFETY_ENDPOINT =
      "https://shared.example.com/";
    process.env.AZURE_CONTENT_SAFETY_KEY = "shared-key";
  });

  describe("given the project has no azure_safety provider", () => {
    describe("when the helper is called", () => {
      it("returns null", async () => {
        getProjectModelProvidersMock.mockResolvedValue({
          openai: {
            provider: "openai",
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-x" },
          },
        });

        const result = await getAzureSafetyEnvFromProject(projectId);
        expect(result).toBeNull();
      });

      it("does not fall back to process.env", async () => {
        getProjectModelProvidersMock.mockResolvedValue({});

        const result = await getAzureSafetyEnvFromProject(projectId);
        expect(result).toBeNull();
      });
    });
  });

  describe("given the azure_safety provider is disabled", () => {
    describe("when the helper is called", () => {
      it("returns null", async () => {
        getProjectModelProvidersMock.mockResolvedValue({
          azure_safety: {
            provider: "azure_safety",
            enabled: false,
            customKeys: {
              AZURE_CONTENT_SAFETY_ENDPOINT: "https://x.azure.com/",
              AZURE_CONTENT_SAFETY_KEY: "real-key",
            },
          },
        });

        const result = await getAzureSafetyEnvFromProject(projectId);
        expect(result).toBeNull();
      });
    });
  });

  describe("given the azure_safety provider is missing a key", () => {
    describe("when the helper is called with missing endpoint", () => {
      it("returns null", async () => {
        getProjectModelProvidersMock.mockResolvedValue({
          azure_safety: {
            provider: "azure_safety",
            enabled: true,
            customKeys: {
              AZURE_CONTENT_SAFETY_KEY: "real-key",
            },
          },
        });

        const result = await getAzureSafetyEnvFromProject(projectId);
        expect(result).toBeNull();
      });
    });

    describe("when the helper is called with missing subscription key", () => {
      it("returns null", async () => {
        getProjectModelProvidersMock.mockResolvedValue({
          azure_safety: {
            provider: "azure_safety",
            enabled: true,
            customKeys: {
              AZURE_CONTENT_SAFETY_ENDPOINT: "https://x.azure.com/",
            },
          },
        });

        const result = await getAzureSafetyEnvFromProject(projectId);
        expect(result).toBeNull();
      });
    });

    describe("when either value is an empty string", () => {
      it("returns null for empty endpoint", async () => {
        getProjectModelProvidersMock.mockResolvedValue({
          azure_safety: {
            provider: "azure_safety",
            enabled: true,
            customKeys: {
              AZURE_CONTENT_SAFETY_ENDPOINT: "",
              AZURE_CONTENT_SAFETY_KEY: "real-key",
            },
          },
        });

        const result = await getAzureSafetyEnvFromProject(projectId);
        expect(result).toBeNull();
      });

      it("returns null for empty key", async () => {
        getProjectModelProvidersMock.mockResolvedValue({
          azure_safety: {
            provider: "azure_safety",
            enabled: true,
            customKeys: {
              AZURE_CONTENT_SAFETY_ENDPOINT: "https://x.azure.com/",
              AZURE_CONTENT_SAFETY_KEY: "",
            },
          },
        });

        const result = await getAzureSafetyEnvFromProject(projectId);
        expect(result).toBeNull();
      });
    });
  });

  describe("given the azure_safety provider is fully configured and enabled", () => {
    describe("when the helper is called", () => {
      it("returns env vars from the project config", async () => {
        getProjectModelProvidersMock.mockResolvedValue({
          azure_safety: {
            provider: "azure_safety",
            enabled: true,
            customKeys: {
              AZURE_CONTENT_SAFETY_ENDPOINT:
                "https://my-account.cognitiveservices.azure.com/",
              AZURE_CONTENT_SAFETY_KEY: "my-subscription-key",
            },
          },
        });

        const result = await getAzureSafetyEnvFromProject(projectId);
        expect(result).toEqual({
          AZURE_CONTENT_SAFETY_ENDPOINT:
            "https://my-account.cognitiveservices.azure.com/",
          AZURE_CONTENT_SAFETY_KEY: "my-subscription-key",
        });
      });

      it("does not use process.env as a fallback when keys differ", async () => {
        process.env.AZURE_CONTENT_SAFETY_ENDPOINT = "https://fallback.example.com/";
        process.env.AZURE_CONTENT_SAFETY_KEY = "fallback-key";

        getProjectModelProvidersMock.mockResolvedValue({
          azure_safety: {
            provider: "azure_safety",
            enabled: true,
            customKeys: {
              AZURE_CONTENT_SAFETY_ENDPOINT: "https://project.azure.com/",
              AZURE_CONTENT_SAFETY_KEY: "project-key",
            },
          },
        });

        const result = await getAzureSafetyEnvFromProject(projectId);
        expect(result?.AZURE_CONTENT_SAFETY_ENDPOINT).toBe(
          "https://project.azure.com/",
        );
        expect(result?.AZURE_CONTENT_SAFETY_KEY).toBe("project-key");
      });
    });
  });
});
