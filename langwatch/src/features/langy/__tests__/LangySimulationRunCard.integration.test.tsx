/**
 * @vitest-environment jsdom
 *
 * The chat's simulation-run card used to be a text snapshot: the CLI tool's
 * printed output was regexed for a name, a status word and two preview lines,
 * freezing whatever the tool printed at the moment it ran. These lock the
 * live rework: the card keeps only the run id from the envelope and renders
 * the platform's current state through the same query + polling policy the
 * simulations drawer uses, on the app's own simulation card.
 *
 * @see specs/langy/langy-live-scenario-cards.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

const { mockUseQuery, mockOpenDrawer } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockOpenDrawer: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: { scenarios: { getRunState: { useQuery: mockUseQuery } } },
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "acme" },
  }),
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer }),
}));
vi.mock("~/hooks/useSimulationUpdateListener", () => ({
  useSimulationUpdateListener: () => ({ isConnected: false }),
}));
vi.mock("~/hooks/useSimulationStreamingState", () => ({
  useSimulationStreamingState: () => ({
    streamingMessages: [],
    handleStreamingEvent: vi.fn(),
    clearCompleted: vi.fn(),
  }),
}));
// The snapshot fallback (LangyEvalRunCard) hydrates names through tRPC; the
// live-card behavior under test doesn't need it.
vi.mock("../hooks/useCapabilityData", () => ({
  useCapabilityData: () => ({
    status: "unavailable",
    rows: [],
    loadedCount: 0,
    totalCount: 0,
    isHydrating: false,
  }),
}));

import { LangySimulationRunCard } from "../components/capabilities/LangySimulationRunCard";
import { resolveCapability } from "../components/capabilities/capabilityRegistry";

const RUN_ID = "scenariorun_0002Gu9QAAAABBBBCCCCDDDDEEE";
const descriptor = resolveCapability("langwatch.simulation-run.get")!;

function runData(overrides: Record<string, unknown> = {}) {
  return {
    scenarioId: "scenario_1",
    scenarioRunId: RUN_ID,
    batchRunId: "batch_1",
    scenarioSetId: "set_1",
    name: "Logistics Agent: Refuses unrelated request",
    description: null,
    status: ScenarioRunStatus.SUCCESS,
    results: null,
    messages: [
      { id: "m1", role: "user", content: "check plate XY-12-AB" },
      { id: "m2", role: "assistant", content: "That plate is not in our records." },
    ],
    timestamp: 1,
    updatedAt: 1,
    durationInMs: 1200,
    ...overrides,
  };
}

function renderCard(output: unknown) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangySimulationRunCard
        descriptor={descriptor}
        input={{ command: `langwatch simulation-run get ${RUN_ID} --format json` }}
        output={output}
        projectSlug="acme"
      />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Feature: the run card renders the platform's live state for the run it names", () => {
  describe("given a tool result that references a simulation run by id", () => {
    /** @scenario "The card shows the run's live status and conversation" */
    it("shows the platform's status and conversation, not the tool's printed text", () => {
      // The envelope claims "failed"; the platform says the run SUCCEEDED and
      // the scenario has since been renamed. The card must side with the
      // platform on every field.
      mockUseQuery.mockReturnValue({ data: runData(), error: null });

      renderCard({
        scenarioRunId: RUN_ID,
        status: "failed",
        name: "Stale envelope name",
      });

      expect(mockUseQuery).toHaveBeenCalledWith(
        { projectId: "proj_1", scenarioRunId: RUN_ID },
        expect.anything(),
      );
      expect(
        screen.getByText(/Logistics Agent: Refuses unrelated request/i),
      ).toBeDefined();
      expect(screen.getByText(/That plate is not in our records/i)).toBeDefined();
      expect(screen.queryByText(/Stale envelope name/i)).toBeNull();
      expect(screen.queryByText(/\bfailed\b/i)).toBeNull();
    });
  });

  describe("given the run the card shows is still in progress", () => {
    /** @scenario "A running simulation's card keeps itself fresh" */
    it("polls through the drawer's shared policy and stops once the run is terminal", () => {
      mockUseQuery.mockReturnValue({
        data: runData({ status: ScenarioRunStatus.IN_PROGRESS }),
        error: null,
      });
      renderCard({ scenarioRunId: RUN_ID });

      const options = mockUseQuery.mock.calls[0]![1] as {
        refetchInterval: (data: { status?: ScenarioRunStatus } | undefined) =>
          | number
          | false;
      };
      // The card hands react-query the shared cadence: a live run keeps a
      // polling interval, a finished run stops entirely.
      expect(
        options.refetchInterval({ status: ScenarioRunStatus.IN_PROGRESS }),
      ).toBeGreaterThan(0);
      expect(
        options.refetchInterval({ status: ScenarioRunStatus.SUCCESS }),
      ).toBe(false);
    });
  });

  describe("when I click the run card", () => {
    /** @scenario "Clicking the card opens the run's own detail drawer" */
    it("opens the scenarioRunDetail drawer for that run", () => {
      mockUseQuery.mockReturnValue({ data: runData(), error: null });
      renderCard({ scenarioRunId: RUN_ID });

      fireEvent.click(screen.getByRole("button", { name: /view details/i }));
      expect(mockOpenDrawer).toHaveBeenCalledWith("scenarioRunDetail", {
        urlParams: { scenarioRunId: RUN_ID },
      });
    });
  });

  describe("given a payload without the structured run id", () => {
    // Defensive only: the `simulationRun` card schema requires
    // `scenarioRunId`, so a validated payload always carries it — but a
    // defect upstream must degrade to the snapshot, never guess an id.
    /** @scenario "A card without a run id keeps the snapshot rendering" */
    it("renders the snapshot card and attempts no live run lookup", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <LangySimulationRunCard
            descriptor={descriptor}
            input={{ command: "langwatch simulation-run get run_x" }}
            output={{ name: "A snapshot", status: "SUCCESS" }}
            projectSlug="acme"
          />
        </ChakraProvider>,
      );

      expect(mockUseQuery).not.toHaveBeenCalled();
      // The snapshot card's signature chrome, not the live SimulationCard.
      expect(screen.getByText(/Open in Simulations/i)).toBeDefined();
    });
  });

  describe("given the run id cannot be resolved on this project", () => {
    it("falls back to the snapshot card instead of an error", () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        error: { message: "NOT_FOUND" },
      });
      renderCard({ scenarioRunId: RUN_ID, name: "Envelope snapshot" });

      // The snapshot card renders (its deep-link chip is its signature);
      // no live SimulationCard skeleton is left hanging.
      expect(screen.getByText(/Open in Simulations/i)).toBeDefined();
    });
  });
});

