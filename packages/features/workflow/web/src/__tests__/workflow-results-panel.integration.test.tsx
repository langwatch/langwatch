/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkflowEvaluationResultsLayout,
  WorkflowResultsPanel,
} from "../ui/elements/workflow-results-panel";

function Wrapper({ children }: { children: ReactNode }) {
  return <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>;
}

describe("WorkflowResultsPanel", () => {
  afterEach(cleanup);

  it("shows only the evaluations tab", () => {
    render(
      <WorkflowResultsPanel isCollapsed={false} onCollapse={vi.fn()}>
        <div>Results</div>
      </WorkflowResultsPanel>,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Evaluations")).not.toBeNull();
    expect(screen.queryByText("Optimizations")).toBeNull();
    expect(screen.getByText("Results")).not.toBeNull();
  });

  it("preserves the evaluation loading, waiting, and error copy", () => {
    const result = render(<WorkflowEvaluationResultsLayout status="loading" />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText("Loading...")).not.toBeNull();

    result.rerender(
      <Wrapper>
        <WorkflowEvaluationResultsLayout status="waiting" />
      </Wrapper>,
    );
    expect(screen.getByText("Waiting for evaluation results")).not.toBeNull();

    result.rerender(
      <Wrapper>
        <WorkflowEvaluationResultsLayout status="error" />
      </Wrapper>,
    );
    expect(screen.getByText("Error loading evaluation results")).not.toBeNull();
  });
});
