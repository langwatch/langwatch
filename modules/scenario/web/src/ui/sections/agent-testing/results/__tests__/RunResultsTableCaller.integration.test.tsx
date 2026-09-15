/**
 * @vitest-environment jsdom
 *
 * The results table shows a Caller column only when a run in the table has a
 * caller, reading "Simulated" for a pool run and "You" for a panel run.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { RunResultsTable } from "../run-results-table.tsx";

afterEach(cleanup);

function run({
  scenarioRunId,
  callerKind,
}: {
  scenarioRunId: string;
  callerKind: "simulated" | "human" | undefined;
}): ScenarioRunData {
  return {
    scenarioId: `scenario-${scenarioRunId}`,
    batchRunId: "batch-1",
    scenarioRunId,
    name: `Scenario ${scenarioRunId}`,
    status: ScenarioRunStatus.SUCCESS,
    messages: [],
    timestamp: 0,
    durationInMs: 1000,
    metadata: callerKind
      ? {
          langwatch: {
            targetReferenceId: "agent-1",
            targetType: "voice",
            callerKind,
          },
        }
      : { langwatch: { targetReferenceId: "agent-1", targetType: "http" } },
  } as unknown as ScenarioRunData;
}

function renderTable(runs: ScenarioRunData[]) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <RunResultsTable
        scenarioRuns={runs}
        resolveTargetName={() => "Support line"}
        iterationMap={new Map()}
        onScenarioRunClick={vi.fn()}
      />
    </ChakraProvider>,
  );
}

describe("RunResultsTable Caller column", () => {
  describe("given a pool run and a panel run", () => {
    /** @scenario The results table shows a Caller column for both simulated and panel runs */
    it("shows a Caller column reading Simulated and You", () => {
      renderTable([
        run({ scenarioRunId: "pool", callerKind: "simulated" }),
        run({ scenarioRunId: "panel", callerKind: "human" }),
      ]);

      const header = screen.getByTestId("run-results-table-header");
      expect(within(header).getByText("Caller")).toBeInTheDocument();

      expect(
        within(screen.getByTestId("run-result-row-pool")).getByText(
          "Simulated",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("run-result-row-panel")).getByText("You"),
      ).toBeInTheDocument();
    });
  });

  describe("given no run has a caller", () => {
    it("hides the Caller column", () => {
      renderTable([run({ scenarioRunId: "text", callerKind: undefined })]);
      const header = screen.getByTestId("run-results-table-header");
      expect(within(header).queryByText("Caller")).not.toBeInTheDocument();
    });
  });
});
