/**
 * @vitest-environment node
 *
 * Unit tests for setupModelEnv in evaluation-execution.factories.
 *
 * Mocks getProjectModelProviders and prepareLitellmParams so we can
 * test validation logic in isolation without DB or external calls.
 */

import { describe, expect, it, vi } from "vitest";
import type { MaybeStoredModelProvider } from "~/server/modelProviders/registry";

vi.mock("~/server/api/routers/modelProviders.utils", () => ({
  getProjectModelProviders: vi.fn(),
  prepareLitellmParams: vi.fn().mockResolvedValue({ model: "gemini/gemini-1.5-pro", api_key: "test-key" }),
  prepareEnvKeys: vi.fn().mockReturnValue({}),
}));

vi.mock("~/server/modelProviders/resolveMaxTokensCeiling", () => ({
  resolveMaxTokensCeiling: vi.fn().mockReturnValue(null),
}));

import { setupModelEnv } from "../evaluation-execution.factories";
import { getProjectModelProviders } from "~/server/api/routers/modelProviders.utils";
import { EvaluatorConfigError } from "../errors";

function buildProvider(overrides: Partial<MaybeStoredModelProvider> = {}): MaybeStoredModelProvider {
  return {
    provider: "gemini",
    enabled: true,
    customKeys: null,
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    embeddingsModels: ["gemini-embedding-001"],
    customModels: null,
    customEmbeddingsModels: null,
    deploymentMapping: null,
    extraHeaders: null,
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
        setupModelEnv("gemini/gemini-2.5-pro", false, "proj-1"),
      ).resolves.toBeDefined();
    });
  });

  describe("when model is NOT in registry but IS a custom model", () => {
    it("resolves without error for chat custom models", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({
          customModels: [
            { modelId: "gemini-1.5-pro", displayName: "gemini-1.5-pro", mode: "chat" },
          ],
        }),
      });

      await expect(
        setupModelEnv("gemini/gemini-1.5-pro", false, "proj-1"),
      ).resolves.toBeDefined();
    });

    it("resolves without error for embedding custom models", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({
          customEmbeddingsModels: [
            { modelId: "custom-embed", displayName: "custom-embed", mode: "embedding" },
          ],
        }),
      });

      await expect(
        setupModelEnv("gemini/custom-embed", true, "proj-1"),
      ).resolves.toBeDefined();
    });
  });

  describe("when model is NOT in registry AND NOT a custom model", () => {
    it("throws EvaluatorConfigError", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider(),
      });

      await expect(
        setupModelEnv("gemini/nonexistent-model", false, "proj-1"),
      ).rejects.toThrow(EvaluatorConfigError);
    });
  });

  describe("when provider has no registry models", () => {
    it("allows any model (no whitelist to check against)", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({ models: null }),
      });

      await expect(
        setupModelEnv("gemini/any-model", false, "proj-1"),
      ).resolves.toBeDefined();
    });
  });

  describe("when provider is not configured", () => {
    it("throws EvaluatorConfigError", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({});

      await expect(
        setupModelEnv("gemini/gemini-2.5-pro", false, "proj-1"),
      ).rejects.toThrow("Provider gemini is not configured");
    });
  });

  describe("when provider is disabled", () => {
    it("throws EvaluatorConfigError", async () => {
      vi.mocked(getProjectModelProviders).mockResolvedValue({
        gemini: buildProvider({ enabled: false }),
      });

      await expect(
        setupModelEnv("gemini/gemini-2.5-pro", false, "proj-1"),
      ).rejects.toThrow("Provider gemini is not enabled");
    });
  });
});
