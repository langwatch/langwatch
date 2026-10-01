import type { WireOf } from "@langwatch/api/web";
// @vitest-environment jsdom
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { Evaluator } from "@langwatch/evaluator-contract";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvaluatorListEmptyState } from "../../elements/evaluator-list-empty-state.tsx";
import { EvaluatorListItem } from "../evaluator-list-item.tsx";

const evaluator: WireOf<Evaluator> = {
  id: "evaluator-1",
  projectId: "project-1",
  name: "Exact Match",
  slug: "exact-match",
  type: "evaluator",
  config: { evaluatorType: "langevals/exact_match" },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
};

afterEach(cleanup);

describe("EvaluatorListItem", () => {
  it("renders evaluator details and selects on keyboard activation", async () => {
    const onClick = vi.fn();
    renderWithDesignSystem(
      <EvaluatorListItem
        evaluator={evaluator}
        updatedAtLabel="2 days ago"
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onUseFromApi={vi.fn()}
      />,
    );

    expect(screen.getByTestId("evaluator-card-evaluator-1")).toBeInTheDocument();
    expect(screen.getByText("Exact Match")).toBeInTheDocument();
    expect(screen.getByText("Exact Match Evaluator")).toBeInTheDocument();
    expect(screen.getByText("Updated 2 days ago")).toBeInTheDocument();

    screen.getByRole("button", { name: "Exact Match" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not select when a nested menu trigger receives the key", () => {
    const onClick = vi.fn();
    renderWithDesignSystem(
      <EvaluatorListItem
        evaluator={evaluator}
        updatedAtLabel="2 days ago"
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onUseFromApi={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByTestId("evaluator-menu-evaluator-1"), { key: "Enter" });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("EvaluatorListEmptyState", () => {
  it("uses the caller's item label and action", () => {
    const onCreateNew = vi.fn();
    renderWithDesignSystem(
      <EvaluatorListEmptyState
        onCreateNew={onCreateNew}
        itemLabel="comparison"
        hasHiddenAll={false}
      />,
    );

    expect(screen.getByText("No comparisons yet")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-first-evaluator-button"));
    expect(onCreateNew).toHaveBeenCalledOnce();
  });
});
