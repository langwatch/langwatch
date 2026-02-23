/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  generateScenarioWithAI,
  type GeneratedScenario,
} from "../scenarioGeneration";

describe("generateScenarioWithAI()", () => {
  const mockScenario: GeneratedScenario = {
    name: "Test Scenario",
    situation: "Test situation",
    criteria: ["criterion 1"],
  };

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("when API responds successfully", () => {
    it("returns the generated scenario", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ scenario: mockScenario }),
      });

      const result = await generateScenarioWithAI(
        "test prompt",
        "project-123",
        null
      );

      expect(result).toEqual(mockScenario);
    });

    it("sends correct payload without currentScenario", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ scenario: mockScenario }),
      });

      await generateScenarioWithAI("test prompt", "project-123", null);

      expect(global.fetch).toHaveBeenCalledWith("/api/scenario/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "test prompt",
          currentScenario: null,
          projectId: "project-123",
        }),
      });
    });

    it("sends correct payload with currentScenario", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ scenario: mockScenario }),
      });

      const currentScenario: GeneratedScenario = {
        name: "Current",
        situation: "Current situation",
        criteria: ["existing"],
      };

      await generateScenarioWithAI(
        "refine this",
        "project-123",
        currentScenario
      );

      expect(global.fetch).toHaveBeenCalledWith("/api/scenario/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "refine this",
          currentScenario,
          projectId: "project-123",
        }),
      });
    });
  });

  describe("when API returns an error response", () => {
    it("throws error with message from API", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Custom error message" }),
      });

      await expect(
        generateScenarioWithAI("test prompt", "project-123", null)
      ).rejects.toThrow("Custom error message");
    });

    it("throws default error when API error message is missing", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      });

      await expect(
        generateScenarioWithAI("test prompt", "project-123", null)
      ).rejects.toThrow("Failed to generate scenario");
    });
  });

  describe("when API response is invalid", () => {
    it("throws error when scenario is missing from response", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await expect(
        generateScenarioWithAI("test prompt", "project-123", null)
      ).rejects.toThrow("Invalid response: missing scenario data");
    });
  });
});
