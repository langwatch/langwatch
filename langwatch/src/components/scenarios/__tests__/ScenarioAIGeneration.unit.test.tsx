/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractProviderFromModel,
  formHasContent,
  type GeneratedScenario,
  usePromptHistory,
  useScenarioGeneration,
} from "../ScenarioAIGeneration";

// Clean up after each test to avoid interference
afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Hook Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("usePromptHistory", () => {
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

    expect(thrownError?.message).toBe(
      "Invalid response: missing scenario data",
    );
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
  it("returns false for empty form", () => {
    const mockForm = {
      getValues: (field: string) => {
        if (field === "criteria") return [];
        return "";
      },
    };

    expect(formHasContent(mockForm as never)).toBe(false);
  });

  it("returns true when name has content", () => {
    const mockForm = {
      getValues: (field: string) => {
        if (field === "name") return "Test Name";
        if (field === "criteria") return [];
        return "";
      },
    };

    expect(formHasContent(mockForm as never)).toBe(true);
  });

  it("returns true when situation has content", () => {
    const mockForm = {
      getValues: (field: string) => {
        if (field === "situation") return "Test situation";
        if (field === "criteria") return [];
        return "";
      },
    };

    expect(formHasContent(mockForm as never)).toBe(true);
  });

  it("returns true when criteria has items", () => {
    const mockForm = {
      getValues: (field: string) => {
        if (field === "criteria") return ["criterion 1"];
        return "";
      },
    };

    expect(formHasContent(mockForm as never)).toBe(true);
  });

  it("returns false for whitespace-only name", () => {
    const mockForm = {
      getValues: (field: string) => {
        if (field === "name") return "   ";
        if (field === "criteria") return [];
        return "";
      },
    };

    expect(formHasContent(mockForm as never)).toBe(false);
  });

  it("returns false for whitespace-only situation", () => {
    const mockForm = {
      getValues: (field: string) => {
        if (field === "situation") return "  \n\t  ";
        if (field === "criteria") return [];
        return "";
      },
    };

    expect(formHasContent(mockForm as never)).toBe(false);
  });
});

describe("extractProviderFromModel", () => {
  it("extracts provider from model ID", () => {
    expect(extractProviderFromModel("openai/gpt-4")).toBe("openai");
    expect(extractProviderFromModel("anthropic/claude-3")).toBe("anthropic");
    expect(extractProviderFromModel("azure/gpt-4-turbo")).toBe("azure");
  });

  it("returns the string itself for model without separator", () => {
    expect(extractProviderFromModel("gpt-4")).toBe("gpt-4");
  });

  it("handles empty string", () => {
    expect(extractProviderFromModel("")).toBe("");
  });

  it("handles multiple separators", () => {
    expect(extractProviderFromModel("provider/model/version")).toBe("provider");
  });
});
