/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ScenarioAIGeneration } from "../ScenarioAIGeneration";
import { SCENARIO_AI_PROMPT_KEY } from "../services/scenarioPromptStorage";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-123", defaultModel: "openai/gpt-4" },
  }),
}));

// Mock useDrawer
vi.mock("~/hooks/useDrawer", () => ({
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
  sessionStorage.clear();
});

beforeEach(() => {
  sessionStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Component Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("<ScenarioAIGeneration/>", () => {
  describe("when no stored prompt", () => {
    it("shows prompt view by default", () => {
      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      // Should show the "Need Help?" prompt card
      expect(screen.getByText("Need Help?")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
    });
  });

  describe("when sessionStorage has stored prompt", () => {
    it("shows input view with AI Generation title", async () => {
      sessionStorage.setItem(SCENARIO_AI_PROMPT_KEY, "My initial prompt");

      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      // Should show the "AI Generation" input view
      await waitFor(() => {
        expect(screen.getByText("AI Generation")).toBeInTheDocument();
      });
    });

    it("displays the stored prompt in history", async () => {
      sessionStorage.setItem(SCENARIO_AI_PROMPT_KEY, "My initial prompt");

      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      // Should show the prompt in history
      await waitFor(() => {
        expect(screen.getByText("My initial prompt")).toBeInTheDocument();
      });
    });

    it("clears sessionStorage after consumption", async () => {
      sessionStorage.setItem(SCENARIO_AI_PROMPT_KEY, "My initial prompt");

      render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

      // Should have cleared sessionStorage
      await waitFor(() => {
        expect(sessionStorage.getItem(SCENARIO_AI_PROMPT_KEY)).toBeNull();
      });
    });
  });
});
