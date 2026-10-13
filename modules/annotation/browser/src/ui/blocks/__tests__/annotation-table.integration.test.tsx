// @vitest-environment jsdom

import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import { Table } from "@langwatch/design-system/primitives";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import "@testing-library/jest-dom/vitest";
import { Temporal } from "@langwatch/time";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AnnotationRow } from "../../../model/annotation-row.ts";
import { AnnotationTable } from "../annotation-table.tsx";

afterEach(cleanup);

const annotation: AnnotationWithUser = {
  id: "annotation-1",
  projectId: "project-1",
  traceId: "trace-1",
  userId: "user-1",
  email: null,
  comment: "review comment",
  isThumbsUp: null,
  scoreOptions: { helpful: { value: "yes", reason: "clear answer" } },
  expectedOutput: null,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  createdAt: "2026-08-01T10:30:00Z",
  updatedAt: "2026-08-01T10:30:00Z",
  user: { id: "user-1", name: "Ada", image: null },
};

const row: AnnotationRow = {
  id: "queue-item-1",
  queueItemId: "queue-item-1",
  traceId: "trace-1",
  date: Temporal.Instant.from("2026-08-01T10:00:00Z"),
  doneAt: null,
  createdByUser: { id: "user-2", name: "Bo", image: null },
  trace: {
    trace_id: "trace-1",
    input: { value: "the question" },
    output: { value: "the answer" },
  },
  annotations: [annotation],
};

function renderTable(overrides: Partial<Parameters<typeof AnnotationTable>[0]> = {}) {
  const onToggleRow = vi.fn();
  const onViewTrace = vi.fn();
  const onAddToDataset = vi.fn();
  const onRemoveFromQueue = vi.fn();

  renderWithDesignSystem(
    <Table.Root>
      <AnnotationTable
        rows={[row]}
        activeScoreTypes={[{ id: "helpful", name: "Helpful" }]}
        dateColumnLabel="Date queued"
        selectedRowIds={new Set()}
        allRowsSelected={false}
        someRowsSelected={false}
        onToggleAll={vi.fn()}
        onToggleRow={onToggleRow}
        onRowClick={vi.fn()}
        onViewTrace={onViewTrace}
        onAddToDataset={onAddToDataset}
        onRemoveFromQueue={onRemoveFromQueue}
        renderAvatar={(user) => <span>{user.name}</span>}
        renderTraceField={({ value }) => <span>{value}</span>}
        {...overrides}
      />
    </Table.Root>,
  );

  return { onToggleRow, onViewTrace, onAddToDataset, onRemoveFromQueue };
}

describe("annotation table presentation", () => {
  it("renders review columns and controlled selection", async () => {
    const { onToggleRow } = renderTable({ columnChoices: { "score-helpful": true } });

    expect(screen.getByRole("columnheader", { name: "Date queued" })).toBeInTheDocument();
    expect(screen.getByText("the question")).toBeInTheDocument();
    expect(screen.getByText("the answer")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Select trace trace-1" }));
    expect(onToggleRow).toHaveBeenCalledWith("queue-item-1");
  });

  it("toggles from anywhere on the checkbox's padded target without opening the row", async () => {
    const onRowClick = vi.fn();
    const { onToggleRow } = renderTable({ onRowClick });
    const target = screen.getByRole("checkbox", { name: "Select trace trace-1" }).closest("label");

    expect(target).not.toBeNull();
    await userEvent.click(target!);

    expect(onToggleRow).toHaveBeenCalledWith("queue-item-1");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("opens the row when the row itself is clicked", async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    await userEvent.click(screen.getByText("the question"));

    expect(onRowClick).toHaveBeenCalledWith(row);
  });

  it("keeps row actions separate from row navigation", async () => {
    const { onViewTrace, onAddToDataset, onRemoveFromQueue } = renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Actions for trace trace-1" }));
    fireEvent.click(await screen.findByText("View trace"));
    fireEvent.click(screen.getByRole("button", { name: "Actions for trace trace-1" }));
    fireEvent.click(await screen.findByText("Add to dataset"));
    fireEvent.click(screen.getByRole("button", { name: "Actions for trace trace-1" }));
    fireEvent.click(await screen.findByText("Remove from queue"));

    expect(onViewTrace).toHaveBeenCalledWith(row);
    expect(onAddToDataset).toHaveBeenCalledWith("trace-1");
    expect(onRemoveFromQueue).toHaveBeenCalledWith("queue-item-1");
  });
});
