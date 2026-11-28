/**
 * Integration tests for SimulationConsole's status line and criteria metrics.
 * @vitest-environment jsdom
 * @see specs/features/scenarios/run-view-side-by-side-layout.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { SimulationRunStatus, SimulationVerdict } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SimulationConsole } from "../simulation-console.tsx";

describe("<SimulationConsole />", () => {
  afterEach(cleanup);

  describe("when the run passed", () => {
    it("shows the pass status", () => {
      renderWithDesignSystem(<SimulationConsole status={SimulationRunStatus.SUCCESS} />);

      expect(screen.getByText("Status:")).toBeTruthy();
      expect(screen.getByText("SUCCESS")).toBeTruthy();
      expect(screen.queryByText("FAILED")).toBeNull();
    });
  });

  describe("when the run failed", () => {
    it("shows the fail status", () => {
      renderWithDesignSystem(<SimulationConsole status={SimulationRunStatus.FAILED} />);

      expect(screen.getByText("Status:")).toBeTruthy();
      expect(screen.getByText("FAILED")).toBeTruthy();
      expect(screen.queryByText("SUCCESS")).toBeNull();
    });
  });

  describe("given a completed run with scored criteria", () => {
    describe("when the detail drawer opens", () => {
      it("shows the score rows", () => {
        renderWithDesignSystem(
          <SimulationConsole
            results={{
              verdict: SimulationVerdict.FAILURE,
              metCriteria: ["Stayed polite"],
              unmetCriteria: ["Solved the problem"],
              reasoning: "The run missed one criterion.",
            }}
            status={SimulationRunStatus.FAILED}
            durationInMs={6300}
          />,
        );

        expect(screen.getByText("Success Criteria:")).toBeInTheDocument();
        expect(screen.getByText("1/2")).toBeInTheDocument();
        expect(screen.getByText("Success Rate:")).toBeInTheDocument();
        expect(screen.getByText("50.0%")).toBeInTheDocument();
      });
    });
  });

  describe("given a completed run with no success criteria", () => {
    describe("when the detail drawer opens", () => {
      /** @scenario "A run with no success criteria hides misleading score lines" */
      it("hides the score rows and keeps the duration", () => {
        renderWithDesignSystem(
          <SimulationConsole
            results={{
              verdict: SimulationVerdict.SUCCESS,
              metCriteria: [],
              unmetCriteria: [],
              reasoning: "The scripted run finished successfully.",
            }}
            status={SimulationRunStatus.SUCCESS}
            durationInMs={6300}
          />,
        );

        expect(screen.queryByText("Success Criteria:")).not.toBeInTheDocument();
        expect(screen.queryByText("Success Rate:")).not.toBeInTheDocument();
        expect(screen.getByText("Duration:")).toBeInTheDocument();
        expect(screen.getByText("6.30s")).toBeInTheDocument();
      });
    });
  });
});
