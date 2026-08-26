/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formHasContent,
  type GeneratedScenario,
  usePromptHistory,
  useScenarioGeneration,
} from "../ScenarioAIGeneration";
import { SCENARIO_AI_PROMPT_KEY } from "../services/scenarioPromptStorage";

// Clean up after each test to avoid interference
afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Hook Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("usePromptHistory", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("starts with empty history", () => {
    const { result } = renderHook(() => usePromptHistory());

    expect(result.current.history).toEqual([]);
    expect(result.current.hasHistory).toBe(false);
  });

  it("adds prompts to history", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addPrompt("first prompt");
    });

    expect(result.current.history).toEqual(["first prompt"]);
    expect(result.current.hasHistory).toBe(true);
  });

  it("maintains order of multiple prompts", () => {
    const { result } = renderHook(() => usePromptHistory());

    act(() => {
      result.current.addPrompt("first");
    });
    act(() => {
      result.current.addPrompt("second");
    });
    act(() => {
      result.current.addPrompt("third");
    });

    expect(result.current.history).toEqual(["first", "second", "third"]);
  });

  describe("when sessionStorage has stored prompt", () => {
    it("initializes history with stored prompt", () => {
      sessionStorage.setItem(SCENARIO_AI_PROMPT_KEY, "Stored prompt");

      const { result } = renderHook(() => usePromptHistory());

      expect(result.current.history).toEqual(["Stored prompt"]);
      expect(result.current.hasHistory).toBe(true);
    });

    it("clears sessionStorage after consumption", () => {
      sessionStorage.setItem(SCENARIO_AI_PROMPT_KEY, "Stored prompt");

      renderHook(() => usePromptHistory());

      expect(sessionStorage.getItem(SCENARIO_AI_PROMPT_KEY)).toBeNull();
    });
  });
});

describe("useScenarioGeneration", () => {
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

  it("starts with idle status", () => {
    const { result } = renderHook(() => useScenarioGeneration("project-123"));

    expect(result.current.status).toBe("idle");
  });

  it("sets status to done on successful generation", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ scenario: mockScenario }),
    });

    const { result } = renderHook(() => useScenarioGeneration("project-123"));

    await act(async () => {
      await result.current.generate("test prompt", null);
    });

    expect(result.current.status).toBe("done");
  });

  it("returns generated scenario on success", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ scenario: mockScenario }),
    });

    const { result } = renderHook(() => useScenarioGeneration("project-123"));

    let scenario: GeneratedScenario | undefined;
    await act(async () => {
      scenario = await result.current.generate("test prompt", null);
    });

    expect(scenario).toEqual(mockScenario);
  });

  it("sets status to error on API failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "API error" }),
    });

    const { result } = renderHook(() => useScenarioGeneration("project-123"));

    await act(async () => {
      try {
        await result.current.generate("test prompt", null);
      } catch {
        // Expected to throw
      }
    });

    expect(result.current.status).toBe("error");
  });

  it("throws error with message from API", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Custom error message" }),
    });

    const { result } = renderHook(() => useScenarioGeneration("project-123"));

    let thrownError: Error | undefined;
    await act(async () => {
      try {
        await result.current.generate("test prompt", null);
      } catch (error) {
        thrownError = error as Error;
      }
    });

    expect(thrownError?.message).toBe("Custom error message");
  });

  it("throws error when scenario is missing from response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const { result } = renderHook(() => useScenarioGeneration("project-123"));

    let thrownError: Error | undefined;
    await act(async () => {
      try {
        await result.current.generate("test prompt", null);
      } catch (error) {
        thrownError = error as Error;
      }
    });

    expect(thrownError?.message).toBe("Invalid response: missing scenario data");
  });

  it("sends correct payload to API", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ scenario: mockScenario }),
    });

    const { result } = renderHook(() => useScenarioGeneration("project-123"));

    const currentScenario: GeneratedScenario = {
      name: "Current",
      situation: "Current situation",
      criteria: ["existing"],
    };

    await act(async () => {
      await result.current.generate("refine this", currentScenario);
    });

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

// ─────────────────────────────────────────────────────────────────────────────
// Pure Function Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("formHasContent", () => {
  it.each([
    {
      description: "an empty form",
      input: { name: "", situation: "", criteria: [] },
      expected: false,
    },
    {
      description: "a name",
      input: { name: "Test Name", situation: "", criteria: [] },
      expected: true,
    },
    {
      description: "a situation",
      input: { name: "", situation: "Test situation", criteria: [] },
      expected: true,
    },
    {
      description: "criteria",
      input: { name: "", situation: "", criteria: ["criterion 1"] },
      expected: true,
    },
    {
      description: "whitespace only",
      input: { name: "   ", situation: "  \n\t  ", criteria: [] },
      expected: false,
    },
  ])("returns $expected for $description", ({ input, expected }) => {
    expect(formHasContent(input)).toBe(expected);
  });
});
