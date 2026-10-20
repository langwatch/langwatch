/**
 * @vitest-environment jsdom
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ScenarioRunStatus, SimulationVerdict } from "@langwatch/scenario-contract";
import type {
  ScenarioHookResult,
  ScenarioRunData,
  ScenarioRunHooks,
} from "@langwatch/scenario-contract";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runState: null as ScenarioRunData | null }));

vi.mock("../../../../../behavior/scenario-api.ts", () => ({
  api: { agents: { getAll: { useQuery: () => ({ data: [] }) } } },
}));
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
  },
}));
vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    useUtils: () => ({ scenarios: { getRunState: { invalidate: vi.fn() } } }),
    scenarios: {
      getRunState: { useQuery: () => ({ data: mocks.runState, error: null }) },
      getByIdIncludingArchived: { useQuery: () => ({ data: { archivedAt: null } }) },
      getBatchRunData: { useQuery: () => ({ data: undefined }) },
    },
  },
}));
vi.mock("../../../../../model/scenario-host.ts", () => ({
  useScenarioHost: () => ({ hasPermission: () => true, isLoading: () => false }),
}));
vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
  useDrawerParams: () => ({ scenarioRunId: "run_1" }),
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1", slug: "test-project" } }),
}));
vi.mock("../../../../../behavior/use-deja-view-link.ts", () => ({
  useDejaViewLink: () => ({ href: null }),
}));
vi.mock("../../../../../behavior/use-drawer-run-callbacks.ts", () => ({
  useDrawerRunCallbacks: () => ({ onRunComplete: vi.fn(), onRunFailed: vi.fn() }),
}));
vi.mock("../../../../../behavior/suites/use-cancel-scenario-run.ts", () => ({
  isCancellableStatus: () => false,
  useCancelScenarioRun: () => ({ cancelJob: vi.fn() }),
}));
vi.mock("../../../simulations/use-run-again-actions.ts", () => ({
  useRunAgainActions: () => ({}),
}));
vi.mock("../../../../../behavior/use-simulation-streaming-state.ts", () => ({
  useSimulationStreamingState: () => ({
    streamingMessages: [],
    handleStreamingEvent: vi.fn(),
    reconcileWithServer: vi.fn(),
  }),
}));
vi.mock("../../../../../behavior/use-simulation-update-listener.ts", () => ({
  useSimulationUpdateListener: () => ({ isConnected: true }),
}));
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn(), query: {}, pathname: "/" }),
}));

import { AgentTestingRunDrawer } from "../agent-testing-run-drawer.tsx";

type Hooks = ScenarioRunHooks;

function buildRunState({
  status = ScenarioRunStatus.SUCCESS,
  hooks,
  results = {
    verdict: SimulationVerdict.SUCCESS,
    reasoning: "All criteria met",
    metCriteria: ["Refunds the duplicate"],
    unmetCriteria: [],
  },
}: {
  status?: ScenarioRunStatus;
  hooks?: Hooks;
  results?: ScenarioRunData["results"];
}): ScenarioRunData {
  return {
    scenarioId: "scenario_1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    name: "Refund a duplicate charge",
    status,
    metadata: {
      langwatch: {
        targetReferenceId: "agent_shop",
        targetType: "connected",
        ...(hooks ? { hooks } : {}),
      },
    },
    results,
    messages: [],
    timestamp: 1785177315009,
    durationInMs: 8400,
  };
}

const SETUP_OK: ScenarioHookResult = { status: "ok", durationMs: 400, state: { order_id: "42" } };

function renderDrawer() {
  renderWithDesignSystem(<AgentTestingRunDrawer open={true} />);
}

describe("<AgentTestingRunDrawer/> setup and teardown", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    mocks.runState = null;
    vi.clearAllMocks();
  });

  describe("given a run whose setup failed and whose teardown returned an object", () => {
    const arrange = () => {
      mocks.runState = buildRunState({
        status: ScenarioRunStatus.ERROR,
        results: null,
        hooks: {
          setup: { status: "failed", durationMs: 300, error: "KeyError: customer_id" },
          teardown: { status: "ok", durationMs: 200, returned: { deleted: 3 } },
        },
      });
      renderDrawer();
    };

    /** @scenario "A run opened from Agent testing shows its hooks" */
    it("shows the Not scored chip", () => {
      arrange();

      expect(screen.getByText("Not scored")).toBeInTheDocument();
    });

    /** @scenario "A run opened from Agent testing shows its hooks" */
    it("shows the Setup band as failed with its error", () => {
      arrange();

      const band = screen.getByTestId("hook-band-setup");
      expect(band).toHaveTextContent("Setup failed");
      expect(band).toHaveTextContent("KeyError: customer_id");
    });

    /** @scenario "A run opened from Agent testing shows its hooks" */
    it("shows the Teardown band with the object it returned", () => {
      arrange();

      const band = screen.getByTestId("hook-band-teardown");
      expect(within(band).getByTestId("hook-teardown-returned")).toHaveTextContent("deleted3");
    });

    /** @scenario "A run opened from Agent testing shows its hooks" */
    it("does not show No response", () => {
      arrange();

      expect(screen.queryByTestId("scenario-no-response")).toBeNull();
    });
  });

  describe("given a run whose setup and teardown both succeeded", () => {
    const arrange = () => {
      mocks.runState = buildRunState({
        hooks: { setup: SETUP_OK, teardown: { status: "ok", durationMs: 200 } },
      });
      renderDrawer();
    };

    /** @scenario "A run opened from Agent testing shows its hooks" */
    it("shows the Setup band with the state it made before the conversation", () => {
      arrange();

      const band = screen.getByTestId("hook-band-setup");
      expect(within(band).getByTestId("hook-setup-state")).toHaveTextContent("42");
    });

    /** @scenario "A run opened from Agent testing shows its hooks" */
    it("shows the Teardown band", () => {
      arrange();

      expect(screen.getByTestId("hook-band-teardown")).toBeInTheDocument();
    });

    /** @scenario "A run opened from Agent testing shows its hooks" */
    it("does not show Not scored", () => {
      arrange();

      expect(screen.queryByText("Not scored")).toBeNull();
    });
  });

  describe("given a finished run with no hooks metadata", () => {
    const arrange = () => {
      mocks.runState = buildRunState({});
      renderDrawer();
    };

    /** @scenario "A run opened from Agent testing shows its hooks" */
    it("shows no Setup band", () => {
      arrange();

      expect(screen.queryByTestId("hook-band-setup")).toBeNull();
    });

    /** @scenario "A run opened from Agent testing shows its hooks" */
    it("shows no Teardown band", () => {
      arrange();

      expect(screen.queryByTestId("hook-band-teardown")).toBeNull();
    });

    /** @scenario "A run opened from Agent testing shows its hooks" */
    it("marks the run No hooks as the classic drawer does", () => {
      arrange();

      expect(screen.getByTestId("hook-band-none")).toHaveTextContent("No hooks");
    });
  });
});
