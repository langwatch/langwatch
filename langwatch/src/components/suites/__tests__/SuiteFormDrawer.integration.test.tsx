/**
 * @vitest-environment jsdom
 *
 * Integration tests for SuiteFormDrawer component.
 *
 * Tests validation behavior, edit mode pre-population,
 * and scenario search filtering.
 *
 * The drawer uses the registry pattern: open state comes from
 * `useDrawer().drawerOpen("suiteEditor")` and edit mode is
 * determined by `useDrawerParams().suiteId`.
 *
 * @see specs/suites/suite-workflow.feature - "Create / Edit Suite"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SimulationSuiteConfiguration } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuiteFormDrawer } from "../SuiteFormDrawer";

// -- Mock data --

const mockScenarios = [
  { id: "scen_1", name: "Angry refund request", labels: ["billing"] },
  { id: "scen_2", name: "Policy violation", labels: ["safety"] },
  { id: "scen_3", name: "Happy path checkout", labels: ["billing"] },
];

const mockAgents = [
  {
    id: "agent_1",
    name: "Prod Agent",
    type: "http",
    config: {},
    workflowId: null,
    projectId: "proj_1",
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const mockPrompts = [
  {
    id: "prompt_1",
    name: "Test Prompt",
    handle: "test-prompt",
  },
];

// -- Hoisted mocks --

const mocks = vi.hoisted(() => ({
  mockCreateMutate: vi.fn(),
  mockUpdateMutate: vi.fn(),
  mockRunMutate: vi.fn(),
  mockDrawerOpen: vi.fn(() => true),
  mockDrawerParams: {} as Record<string, string | undefined>,
  mockGetByIdData: null as SimulationSuiteConfiguration | null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      getAll: {
        useQuery: vi.fn(() => ({ data: mockScenarios })),
      },
    },
    agents: {
      getAll: {
        useQuery: vi.fn(() => ({ data: mockAgents })),
      },
    },
    prompts: {
      getAllPromptsForProject: {
        useQuery: vi.fn(() => ({ data: mockPrompts })),
      },
    },
    suites: {
      create: {
        useMutation: vi.fn(() => ({
          mutate: (...args: any[]) => {
            mocks.mockCreateMutate(...args);
          },
          isPending: false,
        })),
      },
      update: {
        useMutation: vi.fn(() => ({
          mutate: (...args: any[]) => {
            mocks.mockUpdateMutate(...args);
          },
          isPending: false,
        })),
      },
      run: {
        useMutation: vi.fn(() => ({
          mutate: mocks.mockRunMutate,
          isPending: false,
        })),
      },
      getById: {
        useQuery: vi.fn(() => ({ data: mocks.mockGetByIdData })),
      },
    },
    useContext: vi.fn(() => ({
      suites: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    })),
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    project: { id: "proj_1", slug: "test-project" },
  })),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: vi.fn(() => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    drawerOpen: mocks.mockDrawerOpen,
  })),
  useDrawerParams: vi.fn(() => mocks.mockDrawerParams),
  getFlowCallbacks: vi.fn(() => undefined),
}));

vi.mock("../ui/drawer", () => ({
  Drawer: {
    Root: ({ children, open }: any) =>
      open ? <div data-testid="drawer">{children}</div> : null,
    Backdrop: () => null,
    Content: ({ children }: any) => <div>{children}</div>,
    Header: ({ children }: any) => <div>{children}</div>,
    Title: ({ children }: any) => <div>{children}</div>,
    CloseTrigger: () => null,
    Body: ({ children }: any) => <div>{children}</div>,
    Footer: ({ children }: any) => <div>{children}</div>,
  },
}));

vi.mock("../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, children, ...props }: any) => (
    <label>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={() => onCheckedChange?.({ checked: !checked })}
        data-testid={props["data-testid"]}
      />
      {children}
    </label>
  ),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeSuiteConfig(
  overrides: Partial<SimulationSuiteConfiguration> = {},
): SimulationSuiteConfiguration {
  return {
    id: "suite_1",
    projectId: "proj_1",
    name: "My Suite",
    description: "A test suite",
    scenarioIds: ["scen_1", "scen_2"],
    targets: [{ type: "http", referenceId: "agent_1" }],
    repeatCount: 1,
    labels: ["regression"],
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("<SuiteFormDrawer/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mocks.mockCreateMutate.mockClear();
    mocks.mockUpdateMutate.mockClear();
    mocks.mockRunMutate.mockClear();
    // Default: drawer is open, no suiteId (create mode), no suite data
    mocks.mockDrawerOpen.mockReturnValue(true);
    mocks.mockDrawerParams = {};
    mocks.mockGetByIdData = null;
  });

  describe("given the drawer is open in create mode", () => {
    describe("when Save is clicked with an empty name", () => {
      it("shows a name validation error", async () => {
        const user = userEvent.setup();

        render(<SuiteFormDrawer />, { wrapper: Wrapper });

        const saveButton = screen.getByRole("button", { name: /Save/i });
        await user.click(saveButton);

        expect(screen.getByText("Name is required")).toBeInTheDocument();
      });
    });

    describe("when Save is clicked with a name but no scenarios selected", () => {
      it("shows a scenarios validation error", async () => {
        const user = userEvent.setup();

        render(<SuiteFormDrawer />, { wrapper: Wrapper });

        // Type a name
        const nameInput = screen.getByPlaceholderText(
          "e.g., Critical Path Suite",
        );
        await user.type(nameInput, "Test Suite");

        const saveButton = screen.getByRole("button", { name: /Save/i });
        await user.click(saveButton);

        expect(
          screen.getByText("At least one scenario is required"),
        ).toBeInTheDocument();
      });
    });

    describe("when Save is clicked with a name but no targets selected", () => {
      it("shows a targets validation error", async () => {
        const user = userEvent.setup();

        render(<SuiteFormDrawer />, { wrapper: Wrapper });

        // Type a name
        const nameInput = screen.getByPlaceholderText(
          "e.g., Critical Path Suite",
        );
        await user.type(nameInput, "Test Suite");

        // Select a scenario by clicking its checkbox
        const checkboxes = screen.getAllByRole("checkbox");
        await user.click(checkboxes[0]!);

        const saveButton = screen.getByRole("button", { name: /Save/i });
        await user.click(saveButton);

        expect(
          screen.getByText("At least one target is required"),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given the drawer is open in edit mode", () => {
    beforeEach(() => {
      mocks.mockDrawerParams = { suiteId: "suite_1" };
    });

    describe("when the drawer opens with a suite", () => {
      it("pre-populates the name field", () => {
        mocks.mockGetByIdData = makeSuiteConfig({ name: "Regression Suite" });

        render(<SuiteFormDrawer />, { wrapper: Wrapper });

        const nameInput = screen.getByPlaceholderText(
          "e.g., Critical Path Suite",
        ) as HTMLInputElement;
        expect(nameInput.value).toBe("Regression Suite");
      });

      it("pre-populates the description field", () => {
        mocks.mockGetByIdData = makeSuiteConfig({ description: "Runs every deploy" });

        render(<SuiteFormDrawer />, { wrapper: Wrapper });

        const descInput = screen.getByPlaceholderText(
          "Core journeys that must pass before deploy",
        ) as HTMLTextAreaElement;
        expect(descInput.value).toBe("Runs every deploy");
      });

      it("displays the Edit Suite title", () => {
        mocks.mockGetByIdData = makeSuiteConfig();

        render(<SuiteFormDrawer />, { wrapper: Wrapper });

        expect(screen.getByText("Edit Suite")).toBeInTheDocument();
      });
    });
  });

  describe("given the scenario search box", () => {
    describe("when a search query is typed", () => {
      it("filters the visible scenarios", async () => {
        const user = userEvent.setup();

        render(<SuiteFormDrawer />, { wrapper: Wrapper });

        // All scenarios should be visible initially
        expect(
          screen.getByText("Angry refund request"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("Policy violation"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("Happy path checkout"),
        ).toBeInTheDocument();

        // Type search query
        const searchInput = screen.getByPlaceholderText(
          "Search scenarios...",
        );
        await user.type(searchInput, "Angry");

        // Only matching scenario visible
        expect(
          screen.getByText("Angry refund request"),
        ).toBeInTheDocument();
        expect(
          screen.queryByText("Policy violation"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText("Happy path checkout"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given the repeat count is changed", () => {
    describe("when the user sets repeat count to 3 and saves a valid form", () => {
      it("passes repeatCount as a number to the create mutation", async () => {
        const user = userEvent.setup();

        render(<SuiteFormDrawer />, { wrapper: Wrapper });

        // Fill in required fields
        const nameInput = screen.getByPlaceholderText(
          "e.g., Critical Path Suite",
        );
        await user.type(nameInput, "Test Suite");

        // Select a scenario
        const checkboxes = screen.getAllByRole("checkbox");
        await user.click(checkboxes[0]!);

        // Select a target (agents appear after scenarios)
        const targetCheckboxes = screen.getAllByRole("checkbox");
        // Find the target checkbox - agents/prompts are listed after scenarios
        // Scenarios: scen_1, scen_2, scen_3 (3 checkboxes)
        // Targets: agent_1, prompt_1 (2 checkboxes)
        await user.click(targetCheckboxes[3]!); // First target

        // Open execution options and change repeat count
        const executionOptionsTrigger = screen.getByText("Execution Options");
        await user.click(executionOptionsTrigger);

        const repeatInput = screen.getByDisplayValue("1") as HTMLInputElement;
        await user.clear(repeatInput);
        await user.type(repeatInput, "3");

        // Save
        const saveButton = screen.getByRole("button", { name: /^Save$/i });
        await user.click(saveButton);

        expect(mocks.mockCreateMutate).toHaveBeenCalledTimes(1);
        const payload = mocks.mockCreateMutate.mock.calls[0]![0];
        expect(payload.repeatCount).toBe(3);
        expect(typeof payload.repeatCount).toBe("number");
      });
    });
  });

  describe("given the drawer is closed", () => {
    describe("when drawerOpen returns false", () => {
      it("does not render drawer content", () => {
        mocks.mockDrawerOpen.mockReturnValue(false);

        render(<SuiteFormDrawer />, { wrapper: Wrapper });

        expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
      });
    });
  });
});
