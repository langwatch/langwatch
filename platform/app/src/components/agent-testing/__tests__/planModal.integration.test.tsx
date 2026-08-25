/**
 * @vitest-environment jsdom
 *
 * The run plan dialog of the Agent Testing page: its tabs, what each one
 * holds, how a test suite states its scope, and what saving does.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanModal } from "../plan/PlanModal";

const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockSuiteGetById = vi.hoisted(() => vi.fn());
const mockCloseDrawer = vi.hoisted(() => vi.fn());
const mockDrawerParams = vi.hoisted(() => ({
  current: {} as { suiteId?: string },
}));

const emptyQuery = vi.hoisted(() => () => ({
  data: undefined,
  isLoading: false,
}));

/** Records the options the hook passed, so a test can play the server back. */
const mockUpdateOptions = vi.hoisted(() => ({
  current: null as {
    onSuccess?: (data: unknown) => void;
    onError?: (error: unknown) => void;
  } | null,
}));

const mutationOf = vi.hoisted(
  () =>
    (
      mutate: (...args: unknown[]) => void,
      capture?: {
        current: {
          onSuccess?: (data: unknown) => void;
          onError?: (error: unknown) => void;
        } | null;
      },
    ) =>
    (options?: {
      onSuccess?: (data: unknown) => void;
      onError?: (error: unknown) => void;
    }) => {
      if (capture) capture.current = options ?? null;
      return { mutate, isPending: false, mutateAsync: vi.fn() };
    },
);

/** The tRPC envelope a refusal the server can name arrives in. */
const takenNameError = vi.hoisted(() => () => ({
  data: {
    error: {
      code: "suite_name_taken",
      httpStatus: 409,
      message: "suite_name_taken",
      fault: "customer",
      meta: {},
    },
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      suites: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
        folders: { getAll: { invalidate: vi.fn() } },
      },
      scenarios: { getAll: { invalidate: vi.fn() } },
    }),
    suites: {
      getById: { useQuery: mockSuiteGetById },
      folders: {
        getAll: {
          useQuery: () => ({
            data: [{ id: "folder_1", name: "Checkout" }],
          }),
        },
      },
      create: { useMutation: mutationOf(mockCreate) },
      update: { useMutation: mutationOf(mockUpdate, mockUpdateOptions) },
      run: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      resolveArchivedNames: { useQuery: emptyQuery },
    },
    scenarios: {
      getAll: {
        useQuery: () => ({
          data: [
            {
              id: "scen_1",
              name: "Angry refund request",
              labels: ["refunds"],
              folderId: "folder_1",
            },
            {
              id: "scen_2",
              name: "Edge: empty cart",
              labels: [],
              folderId: null,
            },
          ],
        }),
      },
    },
    agents: {
      getAll: {
        useQuery: () => ({
          data: [{ id: "agent_1", name: "Support bot", type: "http" }],
        }),
      },
    },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
    modelProvider: {
      listAllForProjectForFrontend: { useQuery: emptyQuery },
      getResolvedDefault: { useQuery: emptyQuery },
    },
  },
}));

vi.mock("~/hooks/useCan", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: mockCloseDrawer,
    setFlowCallbacks: vi.fn(),
    drawerOpen: () => true,
  }),
  useDrawerParams: () => mockDrawerParams.current,
  getFlowCallbacks: () => undefined,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), isReady: true }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function storedSuite(overrides: Record<string, unknown> = {}) {
  return {
    id: "suite_1",
    name: "Checkout",
    description: "",
    labels: [],
    scenarioIds: ["scen_1"],
    targets: [{ type: "http", referenceId: "agent_1" }],
    repeatCount: 1,
    simulatorModel: null,
    judgeModel: null,
    kind: "custom",
    ...overrides,
  };
}

describe("the run plan dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrawerParams.current = {};
    mockSuiteGetById.mockReturnValue({ data: undefined, isLoading: false });
  });
  afterEach(cleanup);

  describe("given no run plan is being edited", () => {
    /** @scenario "A new run plan opens on the General tab" */
    it("opens on the General tab and offers to create the plan", () => {
      render(<PlanModal />, { wrapper: Wrapper });

      expect(screen.getByText("New run plan")).toBeInTheDocument();
      expect(screen.getByTestId("plan-modal-tab-general")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("plan-modal-save")).toHaveTextContent(
        "Create run plan",
      );
    });

    /** @scenario "The tabs hold the models and the execution options" */
    it("holds the models on one tab and the execution options on another", async () => {
      const user = userEvent.setup();
      render(<PlanModal />, { wrapper: Wrapper });

      await user.click(screen.getByTestId("plan-modal-tab-models"));
      expect(screen.getByText("User simulator")).toBeInTheDocument();
      expect(screen.getByText("Judge")).toBeInTheDocument();

      await user.click(screen.getByTestId("plan-modal-tab-execution"));
      expect(screen.getByText("Repeat count")).toBeInTheDocument();
      // The run dialog chooses what to run against, so the editor does not.
      expect(screen.queryByTestId("target-picker")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Agents and prompts to be tested"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "A new run plan covers every test case" */
    it("offers the four scopes and starts on all test cases", () => {
      render(<PlanModal />, { wrapper: Wrapper });

      for (const mode of ["all", "folders", "labels", "cases"]) {
        expect(screen.getByTestId(`plan-scope-${mode}`)).toBeInTheDocument();
      }
      expect(screen.getByTestId("plan-scope-all")).toBeChecked();
      expect(screen.getByText("2 test cases will run.")).toBeInTheDocument();
    });

    /** @scenario "A plan can be scoped to chosen test suites" */
    it("counts the cases of the test suites that are ticked", async () => {
      const user = userEvent.setup();
      render(<PlanModal />, { wrapper: Wrapper });

      await user.click(screen.getByTestId("plan-scope-folders"));
      expect(screen.getByText("Checkout")).toBeInTheDocument();
      expect(screen.getByText("0 test cases will run.")).toBeInTheDocument();

      await user.click(screen.getByTestId("plan-scope-folder-folder_1"));
      expect(screen.getByText("1 test case will run.")).toBeInTheDocument();
    });

    /** @scenario "A plan can be scoped to chosen labels" */
    it("counts the cases carrying the labels that are on", async () => {
      const user = userEvent.setup();
      render(<PlanModal />, { wrapper: Wrapper });

      await user.click(screen.getByTestId("plan-scope-labels"));
      expect(screen.getByText("0 test cases will run.")).toBeInTheDocument();

      await user.click(screen.getByTestId("plan-scope-label-refunds"));
      expect(screen.getByText("1 test case will run.")).toBeInTheDocument();
    });

    /** @scenario "A plan can hold a hand-picked list of test cases" */
    it("reads the cases under their test suite and counts the ticked ones", async () => {
      const user = userEvent.setup();
      render(<PlanModal />, { wrapper: Wrapper });

      await user.click(screen.getByTestId("plan-scope-cases"));
      expect(screen.getByText("Checkout")).toBeInTheDocument();
      expect(screen.getByText("Unfiled test cases")).toBeInTheDocument();
      expect(screen.getByText("0 test cases will run.")).toBeInTheDocument();

      await user.click(screen.getByTestId("plan-scope-case-scen_1"));
      expect(screen.getByText("1 test case will run.")).toBeInTheDocument();
    });

    /** @scenario "A new run plan covers every test case" */
    it("carries the scope into the write", async () => {
      const user = userEvent.setup();
      render(<PlanModal />, { wrapper: Wrapper });

      await user.type(screen.getByLabelText("Name"), "Everything");
      await user.click(screen.getByTestId("plan-modal-save"));

      await waitFor(() => expect(mockCreate).toHaveBeenCalled());
      expect(mockCreate.mock.calls[0]![0]).toMatchObject({
        name: "Everything",
        scope: { mode: "all" },
      });
    });
  });

  describe("given a hand assembled run plan", () => {
    beforeEach(() => {
      mockDrawerParams.current = { suiteId: "suite_1" };
      mockSuiteGetById.mockReturnValue({
        data: storedSuite(),
        isLoading: false,
      });
    });

    /** @scenario "An existing run plan reads its own title and save control" */
    it("names the dialog for the plan it is editing", () => {
      render(<PlanModal />, { wrapper: Wrapper });

      expect(screen.getByText("Edit run plan")).toBeInTheDocument();
      expect(screen.getByTestId("plan-modal-save")).toHaveTextContent("Save");
    });

    /** @scenario "Saving a run plan writes it and closes the dialog" */
    it("writes the plan when Save is chosen", async () => {
      const user = userEvent.setup();
      render(<PlanModal />, { wrapper: Wrapper });

      await user.click(screen.getByTestId("plan-modal-save"));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(mockUpdate.mock.calls[0]![0]).toMatchObject({
        id: "suite_1",
        name: "Checkout",
        scenarioIds: ["scen_1"],
      });

      act(() =>
        mockUpdateOptions.current?.onSuccess?.(storedSuite({ id: "suite_1" })),
      );
      expect(mockCloseDrawer).toHaveBeenCalled();
    });

    /** @scenario "A plan the server refuses keeps the dialog open" */
    it("puts a taken name under the name field and stays open", async () => {
      const user = userEvent.setup();
      render(<PlanModal />, { wrapper: Wrapper });

      await user.click(screen.getByTestId("plan-modal-save"));
      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());

      act(() => mockUpdateOptions.current?.onError?.(takenNameError()));

      const name = screen.getByLabelText("Name");
      await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
      expect(
        await screen.findByText(
          "That name is already taken. Pick a different name for this run plan.",
        ),
      ).toBeInTheDocument();
      expect(mockCloseDrawer).not.toHaveBeenCalled();
      expect(screen.getByTestId("plan-modal")).toBeInTheDocument();
    });
  });

  describe("given a run plan that is a test suite", () => {
    beforeEach(() => {
      mockDrawerParams.current = { suiteId: "suite_1" };
      mockSuiteGetById.mockReturnValue({
        data: storedSuite({
          kind: "folder",
          scenarioIds: ["scen_1", "scen_2"],
        }),
        isLoading: false,
      });
    });

    /** @scenario "A test suite states its scope instead of offering a picker" */
    it("states the scope of the suite and offers no picker", () => {
      render(<PlanModal />, { wrapper: Wrapper });

      expect(screen.getByText("Edit test suite")).toBeInTheDocument();
      const scope = screen.getByTestId("plan-fixed-scope");
      expect(scope).toHaveTextContent(
        "Test cases from the Checkout test suite",
      );
      expect(scope).toHaveTextContent("2 cases");
      expect(
        screen.queryByText("Angry refund request"),
      ).not.toBeInTheDocument();
    });
  });
});
