/**
 * @vitest-environment node
 *
 * Unit tests for setupModelEnv in evaluation-execution.factories.
 *
 * Mocks getProjectModelProviders and prepareLitellmParams so we can
 * test validation logic in isolation without DB or external calls.
 */

import { describe, expect, it, vi } from "vitest";
import type { LegacyModelProviderExecution } from "@langwatch/model-provider-server";
import {
  testManagedProviders,
  testModelProviders,
} from "~/server/modelProviders/__tests__/model-provider-services.test-support";

vi.mock("@langwatch/model-provider-server", () => ({
  getProjectModelProviders: vi.fn(),
  prepareLitellmParams: vi
    .fn()
    .mockResolvedValue({ model: "gemini/gemini-1.5-pro", api_key: "test-key" }),
  prepareEnvKeys: vi.fn().mockReturnValue({}),
}));

vi.mock("~/server/modelProviders/resolveMaxTokensCeiling", () => ({
  resolveMaxTokensCeiling: vi.fn().mockReturnValue(null),
}));

import { getProjectModelProviders } from "@langwatch/model-provider-server";
import { EvaluatorConfigError } from "../errors";
import { setupModelEnv } from "../evaluation-execution.factories";

function buildProvider(
  overrides: Partial<LegacyModelProviderExecution> = {},
): LegacyModelProviderExecution {
  return {
    id: "mp_gemini",
    organizationId: "org_1",
    provider: "gemini",
    name: "Gemini",
    enabled: true,
    routingHandle: null,
    scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
    scopeType: "PROJECT",
    scopeId: "proj-1",
    customKeys: null,
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    embeddingsModels: ["gemini-embedding-001"],
    customModels: [],
    customEmbeddingsModels: [],
    deploymentMapping: null,
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    isSystem: false,
    embeddingsUnsupported: false,
    ...overrides,
  };
}

describe("setupModelEnv", () => {
  describe("when model is in the registry list", () => {
    it("resolves without error", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider(),
      });

      await expect(
        setupModelEnv(
          testModelProviders,
          testManagedProviders,
          "gemini/gemini-2.5-pro",
          false,
          "proj-1",
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("when model is NOT in registry but IS a custom model", () => {
    it("resolves without error for chat custom models", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({
          customModels: [
            {
              modelId: "gemini-1.5-pro",
              displayName: "gemini-1.5-pro",
              mode: "chat",
            },
          ],
        }),
      });

      await expect(
        setupModelEnv(
          testModelProviders,
          testManagedProviders,
          "gemini/gemini-1.5-pro",
          false,
          "proj-1",
        ),
      ).resolves.toBeDefined();
    });

    it("resolves without error for embedding custom models", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({
          customEmbeddingsModels: [
            {
              modelId: "custom-embed",
              displayName: "custom-embed",
              mode: "embedding",
            },
          ],
        }),
      });

      await expect(
        setupModelEnv(
          testModelProviders,
          testManagedProviders,
          "gemini/custom-embed",
          true,
          "proj-1",
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("when model is NOT in registry AND NOT a custom model", () => {
    it("throws EvaluatorConfigError", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider(),
      });

      await expect(
        setupModelEnv(
          testModelProviders,
          testManagedProviders,
          "gemini/nonexistent-model",
          false,
          "proj-1",
        ),
      ).rejects.toThrow(EvaluatorConfigError);
    });
  });

  describe("when provider has no registry models", () => {
    it("allows any model (no whitelist to check against)", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({ models: null }),
      });

      await expect(
        setupModelEnv(
          testModelProviders,
          testManagedProviders,
          "gemini/any-model",
          false,
          "proj-1",
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("when provider is not configured", () => {
    it("throws EvaluatorConfigError", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({});

      await expect(
        setupModelEnv(
          testModelProviders,
          testManagedProviders,
          "gemini/gemini-2.5-pro",
          false,
          "proj-1",
        ),
      ).rejects.toThrow("Provider gemini is not configured");
    });
  });

  describe("when provider is disabled", () => {
    it("throws EvaluatorConfigError", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({ enabled: false }),
      });

      await expect(
        setupModelEnv(
          testModelProviders,
          testManagedProviders,
          "gemini/gemini-2.5-pro",
          false,
          "proj-1",
        ),
      ).rejects.toThrow("Provider gemini is not enabled");
    });
  });
});
