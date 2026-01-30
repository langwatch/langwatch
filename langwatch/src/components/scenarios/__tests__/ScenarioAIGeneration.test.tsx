/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  extractProviderFromModel,
  formHasContent,
  type GeneratedScenario,
  ScenarioAIGeneration,
  usePromptHistory,
  useScenarioGeneration,
} from "../ScenarioAIGeneration";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-123", defaultModel: "openai/gpt-4" },
  }),
}));

// Mock useDrawerParams - will be configured per test
let mockDrawerParams: Record<string, string | undefined> = {};
vi.mock("~/hooks/useDrawer", () => ({
  useDrawerParams: () => mockDrawerParams,
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn().mockReturnValue(false),
    goBack: vi.fn(),
    canGoBack: false,
  }),
}));

// Mock useModelSelectionOptions
vi.mock("../../ModelSelector", () => ({
  allModelOptions: [],
  useModelSelectionOptions: () => ({
    modelOption: { isDisabled: false },
  }),
}));

// Mock toaster
vi.mock("../../ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Clean up after each test to avoid interference
afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
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

  it("initializes with initial prompt when provided", () => {
    const { result } = renderHook(() =>
      usePromptHistory({ initialPrompt: "seeded prompt" })
    );

    expect(result.current.history).toEqual(["seeded prompt"]);
    expect(result.current.hasHistory).toBe(true);
  });

  it("allows adding prompts after initialization with initial prompt", () => {
    const { result } = renderHook(() =>
      usePromptHistory({ initialPrompt: "seeded prompt" })
    );

    act(() => {
      result.current.addPrompt("second prompt");
    });

    expect(result.current.history).toEqual(["seeded prompt", "second prompt"]);
  });

  it("handles undefined initial prompt", () => {
    const { result } = renderHook(() =>
      usePromptHistory({ initialPrompt: undefined })
    );

    expect(result.current.history).toEqual([]);
    expect(result.current.hasHistory).toBe(false);
  });

  it("handles empty string initial prompt", () => {
    const { result } = renderHook(() =>
      usePromptHistory({ initialPrompt: "" })
    );

    expect(result.current.history).toEqual([]);
    expect(result.current.hasHistory).toBe(false);
  });

  it("trims whitespace from initial prompt", () => {
    const { result } = renderHook(() =>
      usePromptHistory({ initialPrompt: "  trimmed prompt  " })
    );

    expect(result.current.history).toEqual(["trimmed prompt"]);
  });
});

describe("useScenarioGeneration", () => {
  const mockScenario: GeneratedScenario = {
    name: "Test Scenario",
    situation: "Test situation",
    criteria: ["criterion 1"],
    labels: ["test"],
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
      labels: ["label"],
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

describe("<ScenarioAIGeneration/>", () => {
  beforeEach(() => {
    // Reset mock drawer params by creating a fresh empty object
    mockDrawerParams = {};
  });

  it("shows prompt view by default when no initialPrompt", () => {
    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    // Should show the "Need Help?" prompt card
    expect(screen.getByText("Need Help?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
  });

  it("shows input view when initialPrompt is present in URL params", () => {
    mockDrawerParams.initialPrompt = "Test initial prompt";

    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    // Should show the AI Generation input view, not the prompt view
    expect(screen.getByText("AI Generation")).toBeInTheDocument();
    expect(screen.queryByText("Need Help?")).not.toBeInTheDocument();
  });

  it("displays initialPrompt in history when provided via URL params", () => {
    mockDrawerParams.initialPrompt = "My seeded prompt from modal";

    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    // Should display the initial prompt in the history
    expect(screen.getByText("My seeded prompt from modal")).toBeInTheDocument();
  });

  it("does not seed history when initialPrompt is empty string", () => {
    mockDrawerParams.initialPrompt = "";

    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    // Should show the default prompt view since there's no valid initial prompt
    expect(screen.getByText("Need Help?")).toBeInTheDocument();
  });
});
