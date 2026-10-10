// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeleteConfirmationDialog } from "../src/components/overlays/delete-confirmation-dialog.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

describe("destructive confirmation", () => {
  /** @scenario Destructive confirmation gates clicks and Enter with the same phrase */
  it("requires the phrase for both Enter and clicks and resets after reopening", () => {
    const onConfirm = vi.fn();
    const props = { open: true, onClose: vi.fn(), onConfirm, closeOnConfirm: false };
    const view = renderWithDesignSystem(<DeleteConfirmationDialog {...props} />);
    const input = screen.getByRole("textbox", { name: "Type delete to confirm" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "DELETE" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
    view.rerender(<DeleteConfirmationDialog {...props} open={false} />);
    view.rerender(<DeleteConfirmationDialog {...props} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  /** @scenario Loading prevents destructive confirmation */
  it("blocks Enter while the action or related items are loading", () => {
    const onConfirm = vi.fn();
    const props = { open: true, onClose: vi.fn(), onConfirm, value: "delete" };
    const view = renderWithDesignSystem(<DeleteConfirmationDialog {...props} isLoading />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
    view.rerender(<DeleteConfirmationDialog {...props} isLoadingRelated />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Loading related items");
  });

  /** @scenario Consequences name affected items without a warning callout */
  it("shows group counts, outcomes and at most five names", () => {
    renderWithDesignSystem(
      <DeleteConfirmationDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        consequences={[
          {
            label: "Agents",
            action: "archived",
            items: Array.from({ length: 7 }, (_, i) => ({ id: `${i}`, name: `Agent ${i}` })),
          },
          {
            label: "Online Evaluations",
            action: "deleted",
            items: [{ id: "m", name: "Quality monitor" }],
          },
          { label: "Workflows", action: "archived", items: [] },
        ]}
      />,
    );
    expect(screen.getByText("Agents (7)")).toBeInTheDocument();
    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(screen.getByText("deleted")).toBeInTheDocument();
    expect(screen.getByText("Agent 4")).toBeInTheDocument();
    expect(screen.queryByText("Agent 5")).not.toBeInTheDocument();
    expect(screen.getByText("...and 2 more")).toBeInTheDocument();
    expect(screen.queryByText("Workflows (0)")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /** @scenario Exact operator phrases preserve case and whitespace rules */
  it("preserves exact case with opt-in whitespace trimming", () => {
    renderWithDesignSystem(
      <DeleteConfirmationDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        confirmationWord="RECLAIM"
        caseSensitive
        trimConfirmation
      />,
    );
    const input = screen.getByLabelText("Type RECLAIM to confirm");
    fireEvent.change(input, { target: { value: "reclaim" } });
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    fireEvent.change(input, { target: { value: " RECLAIM " } });
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });
});
