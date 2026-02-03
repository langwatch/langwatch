/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});

// ─────────────────────────────────────────────────────────────────────────────
// Component Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("<ScenarioAIGeneration/>", () => {
  it("shows prompt view by default", () => {
    render(<ScenarioAIGeneration form={null} />, { wrapper: Wrapper });

    // Should show the "Need Help?" prompt card
    expect(screen.getByText("Need Help?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
  });
});
