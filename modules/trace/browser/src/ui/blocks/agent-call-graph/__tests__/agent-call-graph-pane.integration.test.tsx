/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentCallGraphPane } from "../agent-call-graph-pane.tsx";

afterEach(cleanup);

describe("<AgentCallGraphPane/>", () => {
  /** @scenario "The Agents pane shows a loading state and an error state with a retry" */
  it("shows a loading state while the graph loads", () => {
    renderWithDesignSystem(
      <AgentCallGraphPane
        graph={undefined}
        isError={false}
        onRetry={vi.fn()}
        onSelectSpan={vi.fn()}
      />,
    );
    expect(screen.getByTestId("agent-call-graph-loading")).toBeTruthy();
    expect(screen.queryByTestId("agent-call-graph-error")).toBeNull();
  });

  /** @scenario "The Agents pane shows a loading state and an error state with a retry" */
  it("shows the failure with a retry", () => {
    const onRetry = vi.fn();
    renderWithDesignSystem(
      <AgentCallGraphPane graph={undefined} isError onRetry={onRetry} onSelectSpan={vi.fn()} />,
    );
    expect(screen.getByTestId("agent-call-graph-error").textContent).toContain(
      "Couldn't load the agents",
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
