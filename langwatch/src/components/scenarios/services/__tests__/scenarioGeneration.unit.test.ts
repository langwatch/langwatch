/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  generateScenarioWithAI,
  ScenarioGenerationError,
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

  describe("when the response body is not JSON (HTML error page)", () => {
    // Regression for langwatch#5758. The generate endpoint answers with JSON on
    // every outcome, so a NON-JSON body means the response came from a layer in
    // FRONT of the app — a reverse-proxy / gateway 502·504, an auth-redirect
    // login page, a timeout error page, or an older self-hosted Next.js build.
    // Before the fix, `response.json()` threw a raw
    // `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` that leaked to
    // the user and masked the real HTTP status. A real Response is used so the
    // genuine JSON.parse crash is exercised, not a hand-faked reject.
    const HTML_ERROR_BODY =
      "<!DOCTYPE html>\n<html><head><title>502 Bad Gateway</title></head>" +
      "<body><h1>502 Bad Gateway</h1></body></html>";

    beforeEach(() => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        new Response(HTML_ERROR_BODY, {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "content-type": "text/html" },
        })
      );
    });

    it("does not leak a raw JSON.parse error to the caller", async () => {
      const error = await generateScenarioWithAI(
        "test prompt",
        "project-123",
        null
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toMatch(
        /Unexpected token|is not valid JSON|DOCTYPE/i
      );
    });

    it("surfaces the HTTP status so the failure is actionable", async () => {
      const error = await generateScenarioWithAI(
        "test prompt",
        "project-123",
        null
      ).catch((e: unknown) => e);

      expect((error as Error).message).toContain("502");
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

  describe("when API returns a handled domain error", () => {
    it("throws ScenarioGenerationError carrying the kind and meta", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        json: () =>
          Promise.resolve({
            error: "bad_request",
            domainError: {
              kind: "missing_provider",
              meta: { reason: "missing_provider" },
              httpStatus: 400,
            },
          }),
      });

      const error = await generateScenarioWithAI(
        "test prompt",
        "project-123",
        null
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ScenarioGenerationError);
      expect((error as ScenarioGenerationError).kind).toBe("missing_provider");
      expect((error as ScenarioGenerationError).meta).toEqual({
        reason: "missing_provider",
      });
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

    it("throws error when criteria contains objects instead of strings", async () => {
      const malformedScenario = {
        name: "Test Scenario",
        situation: "A situation",
        criteria: [
          { criterion: "Agent acknowledges the error" },
          { criterion: "Agent offers a solution" },
        ],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ scenario: malformedScenario }),
      });

      await expect(
        generateScenarioWithAI("test prompt", "project-123", null)
      ).rejects.toThrow("Invalid scenario data");
    });

    it("throws error when name is missing", async () => {
      const malformedScenario = {
        situation: "A situation",
        criteria: ["criterion 1"],
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ scenario: malformedScenario }),
      });

      await expect(
        generateScenarioWithAI("test prompt", "project-123", null)
      ).rejects.toThrow("Invalid scenario data");
    });
  });
});
