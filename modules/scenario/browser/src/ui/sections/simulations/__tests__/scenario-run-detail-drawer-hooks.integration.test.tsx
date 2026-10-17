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
  SimulationRunMetadata,
} from "@langwatch/scenario-contract";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runState: null as ScenarioRunData | null,
  runScenario: vi.fn(),
}));

vi.mock("../../../../behavior/scenario-api.ts", () => ({
  api: { agents: { getAll: { useQuery: () => ({ data: [] }) } } },
}));
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
  },
}));
vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    scenarios: {
      getRunState: { useQuery: () => ({ data: mocks.runState, error: null }) },
      getByIdIncludingArchived: { useQuery: () => ({ data: { archivedAt: null } }) },
    },
  },
}));
vi.mock("../../scenarios/run-scenario-modal.tsx", () => ({ RunScenarioModal: () => null }));
vi.mock("../../scenarios/scenario-form-drawer.tsx", () => ({ ScenarioFormDrawer: () => null }));
vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
  useDrawerParams: () => ({ scenarioRunId: "run_1" }),
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1", slug: "test-project" } }),
}));
vi.mock("../../../../behavior/use-deja-view-link.ts", () => ({
  useDejaViewLink: () => ({ href: null }),
}));
vi.mock("../../../../behavior/use-drawer-run-callbacks.ts", () => ({
  useDrawerRunCallbacks: () => ({ onRunComplete: vi.fn(), onRunFailed: vi.fn() }),
}));
vi.mock("../../use-run-scenario.ts", () => ({
  useRunScenario: () => ({ runScenario: mocks.runScenario, isRunning: false }),
}));
vi.mock("../../use-scenario-target.ts", () => ({
  useScenarioTarget: () => ({ target: null, setTarget: vi.fn(), hasPersistedTarget: false }),
}));
vi.mock("../../../../behavior/use-simulation-streaming-state.ts", () => ({
  useSimulationStreamingState: () => ({
    streamingMessages: [],
    handleStreamingEvent: vi.fn(),
    reconcileWithServer: vi.fn(),
  }),
}));
vi.mock("../../../../behavior/use-simulation-update-listener.ts", () => ({
  useSimulationUpdateListener: () => ({ isConnected: true }),
}));
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ push: vi.fn(), query: {}, pathname: "/" }),
}));

import { ScenarioRunDetailDrawer } from "../scenario-run-detail-drawer.tsx";

const PASSED: ScenarioRunData["results"] = {
  verdict: SimulationVerdict.SUCCESS,
  reasoning: "All criteria met",
  metCriteria: ["Refunds the duplicate"],
  unmetCriteria: [],
};

type TargetType = NonNullable<NonNullable<SimulationRunMetadata>["langwatch"]>["targetType"];

function buildRunState({
  status = ScenarioRunStatus.SUCCESS,
  hooks,
  targetType = "connected",
  results = PASSED,
}: {
  status?: ScenarioRunStatus;
  hooks?: ScenarioRunHooks;
  targetType?: TargetType;
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
        targetType,
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
  renderWithDesignSystem(<ScenarioRunDetailDrawer open={true} />);
}

describe("<ScenarioRunDetailDrawer/> setup and teardown", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    mocks.runState = null;
    vi.clearAllMocks();
  });

  describe("given a run whose setup failed", () => {
    /** @scenario "A run whose setup failed is not scored" */
    it("shows the setup error, Setup failed and Not scored, and no verdict", () => {
      mocks.runState = buildRunState({
        status: ScenarioRunStatus.ERROR,
        results: null,
        hooks: {
          setup: { status: "failed", durationMs: 300, error: "KeyError: customer_id" },
          teardown: { status: "ok", durationMs: 200 },
        },
      });

      renderDrawer();

      const band = screen.getByTestId("hook-band-setup");
      expect(band).toHaveTextContent("KeyError: customer_id");
      expect(screen.getByText("Setup failed")).toBeInTheDocument();
      expect(screen.getByText("Not scored")).toBeInTheDocument();
      expect(screen.getByTestId("run-not-scored")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-no-response")).toBeNull();
    });
  });

  describe("given a run whose setup timed out", () => {
    /** @scenario "A run whose setup timed out is not scored" */
    it("shows Setup timed out with the timeout error", () => {
      mocks.runState = buildRunState({
        status: ScenarioRunStatus.ERROR,
        results: null,
        hooks: {
          setup: {
            status: "timed_out",
            durationMs: 60_000,
            state: { customer_id: "cus_1" },
            error: "Connected agent call timed out after 60000ms",
          },
        },
      });

      renderDrawer();

      const band = screen.getByTestId("hook-band-setup");
      expect(band).toHaveTextContent("timed out 60.0s");
      expect(band).toHaveTextContent("Connected agent call timed out after 60000ms");
      expect(within(band).getByTestId("hook-setup-state")).toHaveTextContent("cus_1");
      expect(screen.getByText("Setup timed out")).toBeInTheDocument();
      expect(screen.getByText("Not scored")).toBeInTheDocument();
    });
  });

  describe("given a passing run whose teardown failed", () => {
    /**
     * @scenario "A failed teardown leaves a passing verdict passing"
     * @scenario "A failed teardown shows the state it was given and a warning"
     */
    it("keeps the verdict and shows the error, the state it was given and the warning", () => {
      mocks.runState = buildRunState({
        hooks: {
          setup: SETUP_OK,
          teardown: {
            status: "failed",
            durationMs: 3100,
            state: { order_id: "order 42" },
            error: "RuntimeError: order locked",
          },
        },
      });

      renderDrawer();

      const band = screen.getByTestId("hook-band-teardown");
      expect(band).toHaveTextContent("RuntimeError: order locked");
      expect(within(band).getByTestId("hook-teardown-state")).toHaveTextContent("order 42");
      expect(band).toHaveTextContent("Test data may be left behind.");
      expect(screen.getByText("Teardown failed")).toBeInTheDocument();
      expect(screen.queryByText("Not scored")).toBeNull();
    });
  });

  describe("given a teardown that timed out", () => {
    /** @scenario "A teardown that times out counts as failed" */
    it("reads as a failed teardown with the timeout error", () => {
      mocks.runState = buildRunState({
        hooks: {
          setup: SETUP_OK,
          teardown: {
            status: "timed_out",
            durationMs: 60_000,
            state: { order_id: "42" },
            error: "Connected agent call timed out after 60000ms",
          },
        },
      });

      renderDrawer();

      const band = screen.getByTestId("hook-band-teardown");
      expect(band).toHaveTextContent("failed 60.0s");
      expect(band).toHaveTextContent("Connected agent call timed out after 60000ms");
      expect(screen.getByText("Teardown failed")).toBeInTheDocument();
      expect(screen.queryByText(/timed out 60/)).toBeNull();
    });
  });

  describe("given a teardown that returned an object", () => {
    /** @scenario "A teardown's returned object is shown on the run" */
    it("shows it as returned by teardown", () => {
      mocks.runState = buildRunState({
        hooks: {
          setup: SETUP_OK,
          teardown: { status: "ok", durationMs: 200, returned: { deleted: 3 } },
        },
      });

      renderDrawer();

      const band = screen.getByTestId("hook-band-teardown");
      expect(band).toHaveTextContent("Returned by teardown");
      expect(within(band).getByTestId("hook-teardown-returned")).toHaveTextContent("deleted3");
    });
  });

  describe("given a teardown that did not run because the agent went offline", () => {
    /** @scenario 'A teardown that did not happen by accident reads "Teardown not run"' */
    it("reads Teardown not run, never Teardown skipped", () => {
      mocks.runState = buildRunState({
        hooks: {
          setup: SETUP_OK,
          teardown: { status: "not_run", durationMs: 0, error: "No instance answered" },
        },
      });

      renderDrawer();

      expect(screen.getByText("Teardown not run")).toBeInTheDocument();
      expect(screen.queryByText("Teardown skipped")).toBeNull();
    });
  });

  describe("given a run that kept its data", () => {
    /** @scenario "Rerun and keep data skips teardown for that rerun" */
    it("reads Teardown skipped", () => {
      mocks.runState = buildRunState({
        hooks: { setup: SETUP_OK, teardown: { status: "skipped", durationMs: 0 } },
      });

      renderDrawer();

      expect(screen.getByText("Teardown skipped")).toBeInTheDocument();
    });
  });

  describe("given a run on an agent with a teardown", () => {
    /** @scenario "Rerun and keep data skips teardown for that rerun" */
    it("reruns against the same agent with keep data from the actions menu", async () => {
      const user = userEvent.setup();
      mocks.runState = buildRunState({
        hooks: { setup: SETUP_OK, teardown: { status: "ok", durationMs: 200 } },
      });
      mocks.runScenario.mockResolvedValue(undefined);

      renderDrawer();
      await user.click(screen.getByRole("button", { name: "More actions" }));
      await user.click(await screen.findByText("Rerun and keep data"));

      expect(mocks.runScenario).toHaveBeenCalledWith({
        scenarioId: "scenario_1",
        target: { type: "connected", id: "agent_shop" },
        keepData: true,
      });
    });
  });

  describe("given a finished run on an agent that declares no hooks", () => {
    /**
     * @scenario 'An agent with no hooks runs as today and is marked "No hooks"'
     * @scenario "HTTP and code agents never call hooks"
     */
    it("marks the run No hooks and offers no keep-data rerun", async () => {
      const user = userEvent.setup();
      mocks.runState = buildRunState({ targetType: "http" });

      renderDrawer();

      expect(screen.getByTestId("hook-band-none")).toHaveTextContent("No hooks");
      expect(screen.queryByTestId("hook-band-teardown")).toBeNull();
      const more = screen.queryByRole("button", { name: "More actions" });
      if (more) await user.click(more);
      expect(screen.queryByText("Rerun and keep data")).toBeNull();
    });
  });

  describe("given a run against a prompt", () => {
    it("shows no hook band at all", () => {
      mocks.runState = buildRunState({ targetType: "prompt" });

      renderDrawer();

      expect(screen.queryByTestId("hook-band-none")).toBeNull();
      expect(screen.queryByTestId("hook-band-setup")).toBeNull();
    });
  });
});
