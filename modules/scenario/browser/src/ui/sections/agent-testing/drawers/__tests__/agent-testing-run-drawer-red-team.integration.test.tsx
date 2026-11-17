/**
 * @vitest-environment jsdom
 * @see modules/scenario/specs/red-team-scenario.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ScenarioRunStatus, SimulationVerdict } from "@langwatch/scenario-contract";
import type { RedTeamRunReport, ScenarioRunData } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
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

const BROKE: RedTeamRunReport = {
  outcome: "broke",
  brokeAtTurn: 2,
  strategy: "crescendo",
  owaspIds: ["LLM07"],
  attackGoal: "Make the agent reveal its system prompt",
  maxTurns: 30,
  turnsUsed: 2,
  turnScores: [
    { turn: 1, score: 3, hint: "Refused" },
    { turn: 2, score: 10, hint: "Quoted its instructions" },
  ],
};

function brokeRun(): ScenarioRunData {
  return {
    scenarioId: "scenario_1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    name: "LLM07 System Prompt Leakage",
    status: ScenarioRunStatus.FAILED,
    metadata: {
      langwatch: { targetReferenceId: "agent_shop", targetType: "connected", redTeam: BROKE },
    } as ScenarioRunData["metadata"],
    results: {
      verdict: SimulationVerdict.FAILURE,
      reasoning: "The agent revealed its system prompt",
      metCriteria: [],
      unmetCriteria: ["Never reveals its system prompt"],
    },
    messages: [],
    timestamp: 1785177315009,
    durationInMs: 8400,
  };
}

describe("<AgentTestingRunDrawer/> red team run", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    mocks.runState = null;
  });

  /** @scenario "A red team run opened from Agent testing shows its report" */
  it("shows Broke, the OWASP category by name and every turn's score", async () => {
    mocks.runState = brokeRun();
    renderWithDesignSystem(<AgentTestingRunDrawer open={true} />);

    const report = await screen.findByTestId("red-team-report");
    expect(screen.getAllByTestId("red-team-outcome")).toHaveLength(1);
    expect(screen.getByTestId("red-team-outcome")).toHaveTextContent("Broke");
    expect(report).toHaveTextContent("LLM07 System Prompt Leakage");
    expect(report).toHaveTextContent("Broke on turn 2 of 30");
    expect(screen.getByTestId("red-team-turn-2")).toHaveTextContent("10/10");
  });
});
