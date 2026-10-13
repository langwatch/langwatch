// @vitest-environment jsdom
import type { WireOf } from "@langwatch/api/web";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { Evaluator } from "@langwatch/evaluator-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvaluatorApiUsageDialog } from "../ui/blocks/evaluator-api-usage-dialog.tsx";
import { EvaluatorCard } from "../ui/blocks/evaluator-card.tsx";

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

describe("EvaluatorCard", () => {
  it("opens the evaluator from its named button, once", async () => {
    const onClick = vi.fn();
    renderWithDesignSystem(
      <EvaluatorCard evaluator={evaluator} updatedAtLabel="2 days ago" onClick={onClick} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Exact Match" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps the actions menu out of the card's own opener", async () => {
    const onClick = vi.fn();
    const onEdit = vi.fn();
    renderWithDesignSystem(
      <EvaluatorCard
        evaluator={evaluator}
        updatedAtLabel="2 days ago"
        onClick={onClick}
        onEdit={onEdit}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Actions for Exact Match" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("EvaluatorApiUsageDialog", () => {
  it("closes from its Close button", async () => {
    const onClose = vi.fn();
    renderWithDesignSystem(
      <EvaluatorApiUsageDialog evaluator={evaluator} open onClose={onClose} />,
    );

    const closers = await screen.findAllByRole("button", { name: "Close" });
    await userEvent.click(closers[closers.length - 1]!);

    expect(onClose).toHaveBeenCalled();
  });
});
