/**
 * @vitest-environment jsdom
 *
 * The run detail drawer's identity band and its criteria summary: who ran,
 * against which target, how it ended and how long it took, and how many of the
 * judge's criteria the run met.
 *
 * @see specs/features/scenarios/run-view-side-by-side-layout.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunDetailDrawer } from "../scenario-run-detail-drawer";
import { ScenarioRunStatus, Verdict } from "@langwatch/scenario-contract";

const mockGetRunState = vi.hoisted(() => vi.fn());
const mockGetScenario = vi.hoisted(() => vi.fn());
const mockGetBatchRunData = vi.hoisted(() => vi.fn());
const mockOpenDrawer = vi.hoisted(() => vi.fn());
const mockCancelJob = vi.hoisted(() => vi.fn());
const mockInvalidateRunState = vi.hoisted(() => vi.fn());
const mockParams = vi.hoisted(() => ({
  value: {} as Record<string, string | undefined>,
}));

const emptyQuery = vi.hoisted(() => () => ({
  data: undefined,
  isLoading: false,
}));

vi.mock("../../../../behavior/scenario-api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getRunState: { invalidate: mockInvalidateRunState },
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
        getByIdIncludingArchived: { invalidate: vi.fn() },
        listVersions: { invalidate: vi.fn() },
        getBatchRunData: { fetch: vi.fn(async () => ({ runs: [] })) },
      },
      suites: {
        testSuites: { getAll: { invalidate: vi.fn() } },
        getById: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      // The run dialog reads the configurations its scope already ran with.
      getRunConfigurations: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      getRunState: { useQuery: mockGetRunState },
      getById: { useQuery: mockGetScenario },
      getByIdIncludingArchived: { useQuery: mockGetScenario },
      getBatchRunData: { useQuery: mockGetBatchRunData },
      getAll: { useQuery: emptyQuery },
      cancelJob: {
        useMutation: () => ({ mutate: mockCancelJob, isPending: false }),
      },
      cancelBatchRun: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    suites: {
      // Every run of the v2 dialog is queued under a plan name.
      runPlan: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      testSuites: { getAll: { useQuery: emptyQuery } },
    },
    agents: {
      getAll: {
        useQuery: () => ({
          data: [{ id: "agent_1", name: "target-A", type: "http" }],
        }),
      },
    },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
    storedObjects: { headById: { useQuery: () => ({ data: undefined }) } },
  },
}));

vi.mock("../../scenarios/scenario-form-drawer", () => ({
  ScenarioFormDrawer: ({ open }: { open?: boolean }) => (open ? <div>Edit Scenario</div> : null),
}));

vi.mock("../../scenarios/run-scenario-modal", () => ({
  RunScenarioModal: () => null,
}));

vi.mock("../../../../behavior/use-simulation-update-listener", () => ({
  useSimulationUpdateListener: () => ({ isConnected: true }),
}));

vi.mock("../../../../behavior/use-simulation-streaming-state", () => ({
  useSimulationStreamingState: () => ({
    streamingMessages: [],
    handleStreamingEvent: vi.fn(),
    clearCompleted: vi.fn(),
  }),
}));

vi.mock("@langwatch/workflow-web/hooks/useDejaViewLink", () => ({
  useDejaViewLink: () => ({ href: null }),
}));

vi.mock("../../../../behavior/use-drawer-run-callbacks", () => ({
  useDrawerRunCallbacks: () => ({
    onRunComplete: vi.fn(),
    onRunFailed: vi.fn(),
  }),
}));

vi.mock("../../use-run-scenario", () => ({
  useRunScenario: () => ({ runScenario: vi.fn(), isRunning: false }),
}));

vi.mock("../../use-scenario-target", () => ({
  useScenarioTarget: () => ({
    target: null,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
  readScenarioTarget: () => null,
  writeScenarioTarget: vi.fn(),
}));

vi.mock("../../../../behavior/use-can", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
    canGoBack: false,
    drawerOpen: () => false,
    setFlowCallbacks: vi.fn(),
  }),
  useDrawerParams: () => mockParams.value,
  getComplexProps: () => null,
  setFlowCallbacks: vi.fn(),
  clearFlowCallbacks: vi.fn(),
}));

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    organization: { id: "org_1" },
    projectId: "proj_1",
  }),
}));

vi.mock("@langwatch/ui-host/use-router", () => ({
  useRouter: () => ({
    query: {},
    asPath: "/test-project/agent-testing",
    push: vi.fn(),
    isReady: true,
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeRunState(overrides: Record<string, unknown> = {}) {
  return {
    scenarioRunId: "run_1",
    scenarioId: "case_1",
    batchRunId: "batch_1",
    name: "Angry refund request",
    status: ScenarioRunStatus.SUCCESS,
    results: {
      verdict: Verdict.SUCCESS,
      metCriteria: ["stays polite", "offers the refund"],
      unmetCriteria: [],
    },
    messages: [
      { id: "m1", role: "user", content: "I want my money back" },
      { id: "m2", role: "assistant", content: "Let me help with that refund" },
    ],
    metadata: {
      langwatch: {
        targetReferenceId: "agent_1",
        targetType: "http",
        scenarioVersion: 3,
      },
    },
    timestamp: Date.now(),
    durationInMs: 6300,
    totalCost: 0.0042,
    ...overrides,
  };
}

function setRunState(state: Record<string, unknown> | undefined, error?: unknown) {
  mockGetRunState.mockReturnValue({ data: state, error: error ?? null });
}

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("the run detail drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParams.value = { scenarioRunId: "run_1" };
    mockGetScenario.mockReturnValue({
      data: { id: "case_1", name: "Echo user request", version: 1, archivedAt: null },
      isLoading: false,
    });
    mockGetBatchRunData.mockReturnValue({ data: undefined });
    setWindowWidth(1400);
  });

  afterEach(cleanup);

  describe('given a failed run of "Echo user request" against target-A', () => {
    beforeEach(() => {
      setRunState(
        makeRunState({
          name: "Echo user request",
          status: ScenarioRunStatus.FAILED,
          durationInMs: 6300,
          results: {
            verdict: Verdict.FAILURE,
            metCriteria: [],
            unmetCriteria: [
              "echoes the user request",
              "keeps the wording",
              "answers in one turn",
              "stays under the token budget",
            ],
          },
        }),
      );
    });

    describe("when the detail drawer opens for that run", () => {
      /** @scenario "Drawer header shows run identity and status" */
      it("reads the scenario name, the target it ran against, the failure and the duration", () => {
        render(<ScenarioRunDetailDrawer open />, { wrapper: Wrapper });

        expect(
          screen.getByRole("heading", { name: "target-A: Echo user request" }),
        ).toBeInTheDocument();
        expect(screen.getByText("FAILED")).toBeInTheDocument();
        expect(screen.getAllByText("6.3s").length).toBeGreaterThan(0);
      });

      /** @scenario "Criteria section shows pass/fail summary" */
      it("reads how many criteria passed and names each one with its indicator", () => {
        render(<ScenarioRunDetailDrawer open />, { wrapper: Wrapper });

        const results = document.querySelector('[data-section="results"]') as HTMLElement;
        expect(within(results).getByText("0/4")).toBeInTheDocument();
        expect(within(results).getByText(/Unmet Criteria \(4\)/)).toBeInTheDocument();
        for (const criterion of [
          "echoes the user request",
          "keeps the wording",
          "answers in one turn",
          "stays under the token budget",
        ]) {
          expect(within(results).getByText(new RegExp(criterion))).toBeInTheDocument();
        }
      });
    });
  });
});
