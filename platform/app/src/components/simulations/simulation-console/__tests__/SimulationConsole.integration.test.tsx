/**
 * @vitest-environment jsdom
 *
 * Integration tests for the v1 simulation console.
 *
 * @see specs/features/scenarios/run-view-side-by-side-layout.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { SimulationConsole } from "../SimulationConsole";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<SimulationConsole />", () => {
  afterEach(cleanup);

  describe("given a completed run with scored criteria", () => {
    it("shows the score rows", () => {
      render(
        <SimulationConsole
          results={{
            verdict: Verdict.FAILURE,
            metCriteria: ["Stayed polite"],
            unmetCriteria: ["Solved the problem"],
            reasoning: "The run missed one criterion.",
          }}
          status={ScenarioRunStatus.FAILED}
          durationInMs={6300}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Success Criteria:")).toBeInTheDocument();
      expect(screen.getByText("1/2")).toBeInTheDocument();
      expect(screen.getByText("Success Rate:")).toBeInTheDocument();
      expect(screen.getByText("50.0%")).toBeInTheDocument();
    });
  });

  describe("given a completed run with no success criteria", () => {
    /** @scenario "A run with no success criteria hides misleading score lines" */
    it("hides the score rows and keeps the duration", () => {
      render(
        <SimulationConsole
          results={{
            verdict: Verdict.SUCCESS,
            metCriteria: [],
            unmetCriteria: [],
            reasoning: "The scripted run finished successfully.",
          }}
          status={ScenarioRunStatus.SUCCESS}
          durationInMs={6300}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("Success Criteria:")).not.toBeInTheDocument();
      expect(screen.queryByText("Success Rate:")).not.toBeInTheDocument();
      expect(screen.getByText("Duration:")).toBeInTheDocument();
      expect(screen.getByText("6.30s")).toBeInTheDocument();
    });
  });
});
