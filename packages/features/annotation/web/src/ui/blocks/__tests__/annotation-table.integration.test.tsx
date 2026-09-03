// @vitest-environment jsdom

import { ChakraProvider, defaultSystem, Table } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import { AnnotationTable, type AnnotationRow } from "../../../index";

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
  date: new Date("2026-08-01T10:00:00Z"),
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

  render(
    <ChakraProvider value={defaultSystem}>
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
      </Table.Root>
    </ChakraProvider>,
  );

  return { onToggleRow, onViewTrace, onAddToDataset, onRemoveFromQueue };
}

describe("annotation table presentation", () => {
  it("renders review columns and controlled selection", () => {
    const { onToggleRow } = renderTable();

    expect(screen.getByRole("columnheader", { name: "Date queued" })).toBeInTheDocument();
    expect(screen.getByText("the question")).toBeInTheDocument();
    expect(screen.getByText("the answer")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select trace trace-1" }));
    expect(onToggleRow).toHaveBeenCalledWith("queue-item-1");
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
