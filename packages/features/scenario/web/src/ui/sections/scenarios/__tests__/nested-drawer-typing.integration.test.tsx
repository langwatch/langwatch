/**
 * @vitest-environment jsdom
 *
 * Integration tests for nested drawer typing.
 *
 * Verifies that:
 * - ScenarioFormDrawerFromUrl opens when rendered from the drawer registry
 *   (no explicit `open` prop) and the URL indicates it is active
 * - Keyboard input is captured by the drawer's input fields
 * - The command bar does not steal keystrokes from focused inputs
 *
 * @see specs/features/suites/nested-drawer-typing.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock heavy sub-components
vi.mock("@langwatch/prompt-web/components/prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: () => null,
}));
vi.mock("../save-and-run-menu", () => ({
  SaveAndRunMenu: () => <div data-testid="save-and-run-menu" />,
}));
vi.mock("../scenario-editor-sidebar", () => ({
  ScenarioEditorSidebar: () => null,
}));

import { ScenarioFormDrawerFromUrl } from "../scenario-form-drawer";

const mocks = vi.hoisted(() => ({
  mockDrawerOpen: vi.fn(() => true),
  mockDrawerParams: {} as Record<string, string | undefined>,
  mockComplexProps: {} as Record<string, unknown>,
  mockOpenDrawer: vi.fn(),
  mockCloseDrawer: vi.fn(),
  mockSetFlowCallbacks: vi.fn(),
  mockRunScenario: vi.fn(),
}));

vi.mock("../../../../behavior/scenario-api", () => ({
  api: {
    scenarios: {
      create: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      update: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      getById: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
    agents: {
      getAll: { useQuery: () => ({ data: [] }) },
    },
    prompts: {
      getAllPromptsForProject: { useQuery: () => ({ data: [] }) },
    },
    useUtils: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    openDrawer: mocks.mockOpenDrawer,
    closeDrawer: mocks.mockCloseDrawer,
    drawerOpen: mocks.mockDrawerOpen,
    goBack: vi.fn(),
    canGoBack: false,
    setFlowCallbacks: mocks.mockSetFlowCallbacks,
    getFlowCallbacks: vi.fn(),
  }),
  useDrawerParams: () => mocks.mockDrawerParams,
  getComplexProps: () => mocks.mockComplexProps,
  setFlowCallbacks: mocks.mockSetFlowCallbacks,
  getFlowCallbacks: vi.fn(),
}));

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-123", slug: "my-project" },
    organization: { id: "org-123" },
  }),
}));

vi.mock("../../../../behavior/next-router", () => ({
  useRouter: () => ({
    query: { project: "my-project" },
    pathname: "/[project]/simulations/scenarios",
    asPath: "/my-project/simulations/scenarios",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("../../use-run-scenario", () => ({
  useRunScenario: () => ({
    runScenario: mocks.mockRunScenario,
    isRunning: false,
  }),
}));

vi.mock("../../use-scenario-target", () => ({
  useScenarioTarget: () => ({
    target: null,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
}));

vi.mock("@langwatch/design-system/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ScenarioFormDrawerFromUrl/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockDrawerParams = {};
    mocks.mockComplexProps = {};
    mocks.mockDrawerOpen.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  describe("when rendered from the drawer registry without an open prop", () => {
    it("opens the drawer based on URL state", async () => {
      // Simulates CurrentDrawer rendering without passing `open`
      render(<ScenarioFormDrawerFromUrl />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Create Scenario")).toBeInTheDocument();
      });
    });

    it("stays closed when the URL does not indicate scenarioEditor is active", async () => {
      mocks.mockDrawerOpen.mockReturnValue(false);

      render(<ScenarioFormDrawerFromUrl />, { wrapper: Wrapper });

      // The drawer heading should not appear
      expect(screen.queryByText("Create Scenario")).not.toBeInTheDocument();
    });
  });

  describe("when the drawer is open and user types in an input field", () => {
    /** @scenario "User types in a nested drawer opened from the suite editor" */
    it("receives keyboard input in the name field", async () => {
      const user = userEvent.setup();
      render(<ScenarioFormDrawerFromUrl />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Create Scenario")).toBeInTheDocument();
      });

      const nameInput = screen.getByPlaceholderText(
        "e.g., Angry refund request",
      );
      await user.click(nameInput);
      await user.type(nameInput, "My new scenario");

      expect(nameInput).toHaveValue("My new scenario");
    });
  });

  describe("when an explicit open prop is passed", () => {
    it("respects the explicit prop over URL state", async () => {
      // URL says drawer is NOT active, but explicit prop says it is
      mocks.mockDrawerOpen.mockReturnValue(false);

      render(<ScenarioFormDrawerFromUrl open={true} />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Create Scenario")).toBeInTheDocument();
      });
    });
  });
});
