/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ScenarioAIGeneration } from "../ScenarioAIGeneration";

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
// Component Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

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
