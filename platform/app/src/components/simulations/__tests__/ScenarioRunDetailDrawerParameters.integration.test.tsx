/**
 * @vitest-environment jsdom
 *
 * The run detail drawer shows the parameter values the run resolved, and shows
 * no such section for a run that resolved none.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 * @see specs/scenarios/secret-run-parameters.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

const mocks = vi.hoisted(() => ({
  runState: null as ScenarioRunData | null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      getRunState: {
        useQuery: () => ({ data: mocks.runState, error: null }),
      },
      getByIdIncludingArchived: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

// Child drawers and modals reach for tRPC and the router of their own; the
// parameters section is composed above them.
vi.mock("~/components/scenarios/RunScenarioModal", () => ({
  RunScenarioModal: () => null,
}));
vi.mock("~/components/scenarios/ScenarioFormDrawer", () => ({
  ScenarioFormDrawer: () => null,
}));
vi.mock("../ScenarioRunActions", () => ({
  ScenarioRunActions: () => null,
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn(), openDrawer: vi.fn() }),
  useDrawerParams: () => ({ scenarioRunId: "run_1" }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "test-project" },
  }),
}));
vi.mock("~/hooks/useDejaViewLink", () => ({
  useDejaViewLink: () => ({ href: null }),
}));
vi.mock("~/hooks/useDrawerRunCallbacks", () => ({
  useDrawerRunCallbacks: () => ({
    onRunComplete: vi.fn(),
    onRunFailed: vi.fn(),
  }),
}));
vi.mock("~/hooks/useRunScenario", () => ({
  useRunScenario: () => ({ runScenario: vi.fn(), isRunning: false }),
}));
vi.mock("~/hooks/useScenarioTarget", () => ({
  useScenarioTarget: () => ({
    target: null,
    setTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
}));
vi.mock("~/hooks/useSimulationStreamingState", () => ({
  useSimulationStreamingState: () => ({
    streamingMessages: [],
    handleStreamingEvent: vi.fn(),
    clearCompleted: vi.fn(),
  }),
}));
vi.mock("~/hooks/useSimulationUpdateListener", () => ({
  useSimulationUpdateListener: () => ({ isConnected: true }),
}));
vi.mock("~/hooks/useTargetNameMap", () => ({
  useTargetNameMap: () => new Map<string, string>(),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn(), query: {}, pathname: "/" }),
}));

import { ScenarioRunDetailDrawer } from "../ScenarioRunDetailDrawer";

function buildRunState(metadata: Record<string, unknown> | null) {
  return {
    scenarioId: "scenario_1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    name: "Refund request",
    status: ScenarioRunStatus.SUCCESS,
    metadata,
    results: null,
    messages: [],
    timestamp: 1785177315009,
    durationInMs: 8400,
  } as unknown as ScenarioRunData;
}

function renderDrawer() {
  render(
    <ChakraProvider value={defaultSystem}>
      <ScenarioRunDetailDrawer open={true} />
    </ChakraProvider>,
  );
}

describe("<ScenarioRunDetailDrawer/> parameters", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    mocks.runState = null;
    vi.clearAllMocks();
  });

  describe("given a run that resolved parameter values", () => {
    describe("when the drawer opens", () => {
      /** @scenario "Resolved parameter values are recorded on the run and shown in the run detail drawer" */
      it("shows each name holding the value the run used", () => {
        mocks.runState = buildRunState({
          parameters: { account_tier: "platinum", seats: 12 },
        });

        renderDrawer();

        const section = screen.getByTestId("run-parameters");
        expect(section).toHaveTextContent("account_tier");
        expect(section).toHaveTextContent("platinum");
        expect(section).toHaveTextContent("seats");
        expect(section).toHaveTextContent("12");
      });
    });
  });

  describe("given a run that used a secret parameter", () => {
    describe("when the drawer opens", () => {
      /** @scenario "The run detail drawer masks secret parameter values" */
      it("names the secret and shows a mask in place of a value", () => {
        mocks.runState = buildRunState({
          parameters: { account_tier: "platinum" },
          secretParameterNames: ["api_token"],
        });

        renderDrawer();

        const section = screen.getByTestId("run-parameters");
        expect(section).toHaveTextContent("api_token");
        expect(section).toHaveTextContent("••••••••");
        expect(section).toHaveTextContent("account_tier");
      });

      /** @scenario "The run detail drawer masks secret parameter values" */
      it("carries no value for the secret anywhere in the section", () => {
        mocks.runState = buildRunState({
          secretParameterNames: ["api_token"],
          // A run recorded by a build that wrote more than the names must not
          // put any of it on screen.
          secretParameters: { api_token: "tok-live-1" },
        });

        renderDrawer();

        expect(screen.getByTestId("run-parameters").textContent).toBe(
          "api_token••••••••",
        );
      });

      it("shows the section for a run whose only parameters are secret", () => {
        mocks.runState = buildRunState({
          secretParameterNames: ["api_token"],
        });

        renderDrawer();

        expect(screen.getByTestId("run-parameters")).toBeInTheDocument();
      });

      it("ignores a recorded shape it cannot read", () => {
        mocks.runState = buildRunState({ secretParameterNames: "api_token" });

        renderDrawer();

        expect(screen.queryByTestId("run-parameters")).toBeNull();
      });
    });
  });

  describe("given a run that resolved none", () => {
    describe("when the drawer opens", () => {
      it("shows no parameters section at all", () => {
        for (const metadata of [
          null,
          { langwatch: { targetReferenceId: "agent_1" } },
          { parameters: {} },
        ]) {
          mocks.runState = buildRunState(metadata);
          renderDrawer();

          expect(screen.queryByTestId("run-parameters")).toBeNull();
          cleanup();
        }
      });
    });
  });
});
