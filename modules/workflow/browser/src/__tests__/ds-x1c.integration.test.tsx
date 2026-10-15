/** @vitest-environment jsdom */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkflowEvaluationResultsLayout,
  WorkflowResultsPanel,
} from "../ui/elements/workflow-results-panel.tsx";

function Wrapper({ children }: { children: ReactNode }) {
  return <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>;
}

describe("the workflow results panel", () => {
  afterEach(cleanup);

  it("names its results region by the Evaluations heading", () => {
    render(
      <WorkflowResultsPanel isCollapsed={false} onCollapse={vi.fn()}>
        <div>Results</div>
      </WorkflowResultsPanel>,
      { wrapper: Wrapper },
    );

    expect(screen.getByRole("heading", { name: "Evaluations" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Evaluations" })).toHaveTextContent("Results");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("collapses from the Collapse results button and drops its children while collapsed", () => {
    const onCollapse = vi.fn();
    const view = render(
      <WorkflowResultsPanel isCollapsed={false} onCollapse={onCollapse}>
        <div>Results</div>
      </WorkflowResultsPanel>,
      { wrapper: Wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse results" }));
    expect(onCollapse).toHaveBeenCalledTimes(1);

    view.rerender(
      <Wrapper>
        <WorkflowResultsPanel isCollapsed onCollapse={onCollapse}>
          <div>Results</div>
        </WorkflowResultsPanel>
      </Wrapper>,
    );
    expect(screen.queryByText("Results")).toBeNull();
  });

  it("says what to do next while it waits for the first evaluation", () => {
    render(<WorkflowEvaluationResultsLayout status="waiting" />, { wrapper: Wrapper });

    expect(screen.getByText("Waiting for evaluation results")).toBeInTheDocument();
    expect(
      screen.getByText("Run your first evaluation to see the results here"),
    ).toBeInTheDocument();
  });
});
