import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Evaluator } from "@langwatch/evaluator-contract";
import { EvaluatorListEmptyState, EvaluatorListItem } from "../../../index";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const evaluator: Evaluator = {
  id: "evaluator-1",
  projectId: "project-1",
  name: "Exact Match",
  slug: "exact-match",
  type: "evaluator",
  config: { evaluatorType: "langevals/exact_match" },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-02T00:00:00Z"),
};

afterEach(cleanup);

describe("EvaluatorListItem", () => {
  it("renders evaluator details and selects on keyboard activation", () => {
    const onClick = vi.fn();
    render(
      <EvaluatorListItem
        evaluator={evaluator}
        updatedAtLabel="2 days ago"
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onUseFromApi={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    const card = screen.getByTestId("evaluator-card-evaluator-1");
    expect(screen.getByText("Exact Match")).toBeInTheDocument();
    expect(screen.getByText("Exact Match Evaluator")).toBeInTheDocument();
    expect(screen.getByText("Updated 2 days ago")).toBeInTheDocument();

    fireEvent.keyDown(card, { key: "Enter" });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not select when a nested menu trigger receives the key", () => {
    const onClick = vi.fn();
    render(
      <EvaluatorListItem
        evaluator={evaluator}
        updatedAtLabel="2 days ago"
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onUseFromApi={vi.fn()}
      />,
      { wrapper: Wrapper },
    );

    fireEvent.keyDown(screen.getByTestId("evaluator-menu-evaluator-1"), { key: "Enter" });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("EvaluatorListEmptyState", () => {
  it("uses the caller's item label and action", () => {
    const onCreateNew = vi.fn();
    render(<EvaluatorListEmptyState onCreateNew={onCreateNew} itemLabel="comparison" />, {
      wrapper: Wrapper,
    });

    expect(screen.getByText("No comparisons yet")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-first-evaluator-button"));
    expect(onCreateNew).toHaveBeenCalledOnce();
  });
});
