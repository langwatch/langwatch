/**
 * The small pieces every Agent Testing surface shares: last-run result,
 * cost and scenario version.
 * @vitest-environment jsdom
 * @see specs/features/agent-testing/cases-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CaseVersionChip } from "../case-version-chip.tsx";
import { LastResultLabel } from "../last-result-label.tsx";
import { ResultMetricsInline } from "../result-metrics-inline.tsx";

describe("<LastResultLabel/>", () => {
  afterEach(cleanup);

  it("says how many criteria a passed run met", () => {
    renderWithDesignSystem(
      <LastResultLabel
        status={ScenarioRunStatus.SUCCESS}
        results={{ metCriteria: ["a", "b", "c"], unmetCriteria: [] }}
      />,
    );

    expect(screen.getByText("Passed (3/3)")).toBeInTheDocument();
  });

  it("says how many criteria a failed run missed", () => {
    renderWithDesignSystem(
      <LastResultLabel
        status={ScenarioRunStatus.FAILED}
        results={{ metCriteria: ["a"], unmetCriteria: ["b", "c"] }}
      />,
    );

    expect(screen.getByText("Failed (1/3)")).toBeInTheDocument();
  });

  it("says a scenario never ran", () => {
    renderWithDesignSystem(<LastResultLabel />);

    expect(screen.getByText("Not run")).toBeInTheDocument();
  });

  it("says a run is still going", () => {
    renderWithDesignSystem(<LastResultLabel status={ScenarioRunStatus.IN_PROGRESS} />);

    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});

describe("<ResultMetricsInline/>", () => {
  afterEach(cleanup);

  it("reads the time and the cost of a run", () => {
    renderWithDesignSystem(<ResultMetricsInline durationInMs={6300} totalCost={0.0042} />);

    expect(screen.getByText("6.3s · $0.004200")).toBeInTheDocument();
  });

  it("reads the time alone when there is no cost", () => {
    renderWithDesignSystem(<ResultMetricsInline durationInMs={6300} />);

    expect(screen.getByText("6.3s")).toBeInTheDocument();
  });

  it("draws nothing when there is neither", () => {
    const { container } = renderWithDesignSystem(<ResultMetricsInline />);

    expect(container.textContent).toBe("");
  });
});

describe("<CaseVersionChip/>", () => {
  afterEach(cleanup);

  it("names the version", () => {
    renderWithDesignSystem(<CaseVersionChip version={3} />);

    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("draws nothing while a scenario carries no version", () => {
    const { container } = renderWithDesignSystem(<CaseVersionChip />);

    expect(container.textContent).toBe("");
  });
});
