/**
 * @vitest-environment jsdom
 *
 * The small pieces every Agent Testing surface shares: what the last run
 * said, what it cost, which version of a case ran, and the row that opens a
 * folder of cases.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { CaseVersionChip } from "../shared/case-version-chip";
import { FolderHeaderRow } from "../shared/folder-header-row";
import { LastResultLabel } from "../shared/last-result-label";
import { ResultMetricsInline } from "../shared/result-metrics-inline";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<LastResultLabel/>", () => {
  afterEach(cleanup);

  it("says how many criteria a passed run met", () => {
    render(
      <LastResultLabel
        status={ScenarioRunStatus.SUCCESS}
        results={{ metCriteria: ["a", "b", "c"], unmetCriteria: [] }}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Passed (3/3)")).toBeInTheDocument();
  });

  it("says how many criteria a failed run missed", () => {
    render(
      <LastResultLabel
        status={ScenarioRunStatus.FAILED}
        results={{ metCriteria: ["a"], unmetCriteria: ["b", "c"] }}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Failed (1/3)")).toBeInTheDocument();
  });

  it("says a case never ran", () => {
    render(<LastResultLabel />, { wrapper: Wrapper });

    expect(screen.getByText("Not run")).toBeInTheDocument();
  });

  it("says a run is still going", () => {
    render(<LastResultLabel status={ScenarioRunStatus.IN_PROGRESS} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});

describe("<ResultMetricsInline/>", () => {
  afterEach(cleanup);

  it("reads the time and the cost of a run", () => {
    render(<ResultMetricsInline durationInMs={6300} totalCost={0.0042} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("6.3s · $0.004200")).toBeInTheDocument();
  });

  it("reads the time alone when there is no cost", () => {
    render(<ResultMetricsInline durationInMs={6300} />, { wrapper: Wrapper });

    expect(screen.getByText("6.3s")).toBeInTheDocument();
  });

  it("draws nothing when there is neither", () => {
    const { container } = render(<ResultMetricsInline />, {
      wrapper: Wrapper,
    });

    expect(container.textContent).toBe("");
  });
});

describe("<CaseVersionChip/>", () => {
  afterEach(cleanup);

  it("names the version", () => {
    render(<CaseVersionChip version={3} />, { wrapper: Wrapper });

    expect(screen.getByText("v3")).toBeInTheDocument();
  });

  it("draws nothing while a case carries no version", () => {
    const { container } = render(<CaseVersionChip />, { wrapper: Wrapper });

    expect(container.textContent).toBe("");
  });
});

describe("<FolderHeaderRow/>", () => {
  afterEach(cleanup);

  const renderRow = (
    props: Partial<React.ComponentProps<typeof FolderHeaderRow>> = {},
  ) =>
    render(
      <FolderHeaderRow
        name="Checkout"
        caseCount={4}
        templateColumns="minmax(0,1fr) 170px 112px"
        aggregateSpan={2}
        {...props}
      />,
      { wrapper: Wrapper },
    );

  it("names the folder and how many cases it holds", () => {
    renderRow();

    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByLabelText("4 test cases")).toBeInTheDocument();
  });

  it("counts one case as one", () => {
    renderRow({ caseCount: 1 });

    expect(screen.getByLabelText("1 test case")).toBeInTheDocument();
  });

  it("carries the aggregate it is given", () => {
    renderRow({ children: <span>Pass 100%</span> });

    expect(screen.getByText("Pass 100%")).toBeInTheDocument();
  });

  it("opens the folder when the row is chosen", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderRow({ onClick });

    await user.click(screen.getByText("Checkout"));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("opens the folder from the keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderRow({ onClick });

    await user.tab();
    await user.keyboard("{Enter}");

    expect(onClick).toHaveBeenCalledOnce();
  });
});
