import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ScenarioTable, type ScenarioListItem } from "../src";

class TestResizeObserver {
  observe(): void {}

  unobserve(): void {}

  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const scenarios: ScenarioListItem[] = [
  {
    id: "scenario-1",
    name: "Refund request",
    labels: ["support"],
    updatedAt: new Date("2026-08-25T12:00:00.000Z"),
  },
  {
    id: "scenario-2",
    name: "Account upgrade",
    labels: ["billing"],
    updatedAt: new Date("2026-08-24T12:00:00.000Z"),
  },
];

function renderTable(onRowSelectionChange = vi.fn()) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ScenarioTable
        scenarios={scenarios}
        columnFilters={[]}
        onColumnFiltersChange={vi.fn()}
        onRowClick={vi.fn()}
        rowSelection={{}}
        onRowSelectionChange={onRowSelectionChange}
        onArchive={vi.fn()}
        formatUpdatedAt={(updatedAt) => updatedAt.toISOString()}
        renderLabels={(labels) => labels.join(", ")}
        renderRow={(_scenario, row) => row}
      />
    </ChakraProvider>,
  );
}

describe("ScenarioTable", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps label rendering and select-all behaviour within the portable view", async () => {
    const onRowSelectionChange = vi.fn();
    const user = userEvent.setup();
    renderTable(onRowSelectionChange);

    expect(screen.getByText("support")).toBeInTheDocument();
    expect(screen.getByText("billing")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Select all"));

    expect(onRowSelectionChange).toHaveBeenCalledWith({
      "scenario-1": true,
      "scenario-2": true,
    });
  });

  it("preserves app formatting, row actions, and the row render port", async () => {
    const onArchive = vi.fn();
    const onRowClick = vi.fn();
    const renderRow = vi.fn((_scenario: ScenarioListItem, row: ReactElement) => row);
    const user = userEvent.setup();
    render(
      <ChakraProvider value={defaultSystem}>
        <ScenarioTable
          scenarios={scenarios}
          columnFilters={[]}
          onColumnFiltersChange={vi.fn()}
          onRowClick={onRowClick}
          rowSelection={{}}
          onRowSelectionChange={vi.fn()}
          onArchive={onArchive}
          formatUpdatedAt={(updatedAt) => `formatted:${updatedAt.toISOString()}`}
          renderLabels={(labels) => labels.join("|")}
          renderRow={renderRow}
        />
      </ChakraProvider>,
    );

    expect(screen.getByText("formatted:2026-08-25T12:00:00.000Z")).toBeInTheDocument();
    expect(screen.getByText("support")).toBeInTheDocument();
    expect(renderRow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "scenario-1" }),
      expect.anything(),
    );

    await user.click(screen.getByText("Refund request"));
    expect(onRowClick).toHaveBeenCalledWith("scenario-1");

    await user.click(screen.getByRole("button", { name: "Actions for Refund request" }));
    await user.click(screen.getByText("Archive"));
    expect(onArchive).toHaveBeenCalledWith(scenarios[0]);
  });
});
