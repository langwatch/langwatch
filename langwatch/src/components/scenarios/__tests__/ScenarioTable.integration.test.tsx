/**
 * @vitest-environment jsdom
 *
 * Integration tests for scenario archiving UI.
 *
 * Covers the @integration UI scenarios from scenario-deletion.feature:
 * - Select all checkbox toggles all visible rows
 * - Select all with active filter only selects visible rows
 * - Deselecting all rows hides the batch action bar
 * - Row action menu contains Archive option
 * - Single archive confirmation modal shows scenario name
 * - Cancel single archive dismisses modal without archiving
 * - Batch archive confirmation modal lists all selected scenarios
 * - Cancel batch archive dismisses modal and preserves selection
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Scenario } from "@prisma/client";
import type { RowSelectionState } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioTable } from "../ScenarioTable";
import { BatchActionBar } from "../BatchActionBar";
import { ScenarioArchiveDialog } from "../ScenarioArchiveDialog";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const now = new Date();

function makeScenario(overrides: Partial<Scenario> & { id: string; name: string }): Scenario {
  return {
    projectId: "proj-1",
    situation: "test situation",
    criteria: [],
    labels: [],
    lastUpdatedById: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const scenarios: Scenario[] = [
  makeScenario({ id: "scen_1", name: "Cross-doc synthesis question", labels: ["doc-qa"] }),
  makeScenario({ id: "scen_2", name: "SaaS documentation guidance", labels: ["saas"] }),
  makeScenario({ id: "scen_3", name: "Failed booking escalation", labels: ["booking"] }),
  makeScenario({ id: "scen_4", name: "Angry double-charge refund", labels: ["billing"] }),
  makeScenario({ id: "scen_5", name: "HTTP troubleshooting request", labels: ["http"] }),
];

// ============================================================================
// ScenarioTable - Row Selection
// ============================================================================

describe("<ScenarioTable/>", () => {
  afterEach(() => {
    cleanup();
  });

  function renderTable({
    data = scenarios,
    rowSelection = {},
    onRowSelectionChange = vi.fn(),
    onRowClick = vi.fn(),
    onArchive = vi.fn(),
    columnFilters = [],
    onColumnFiltersChange = vi.fn(),
  }: {
    data?: Scenario[];
    rowSelection?: RowSelectionState;
    onRowSelectionChange?: (selection: RowSelectionState) => void;
    onRowClick?: (id: string) => void;
    onArchive?: (scenario: Scenario) => void;
    columnFilters?: { id: string; value: unknown }[];
    onColumnFiltersChange?: (filters: { id: string; value: unknown }[]) => void;
  } = {}) {
    return render(
      <ScenarioTable
        scenarios={data}
        columnFilters={columnFilters}
        onColumnFiltersChange={onColumnFiltersChange}
        onRowClick={onRowClick}
        rowSelection={rowSelection}
        onRowSelectionChange={onRowSelectionChange}
        onArchive={onArchive}
      />,
      { wrapper: Wrapper },
    );
  }

  // --------------------------------------------------------------------------
  // Row Selection UI
  // --------------------------------------------------------------------------

  describe("when select all checkbox is clicked", () => {
    it("toggles all visible scenario row checkboxes to checked", async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();
      renderTable({ onRowSelectionChange: onSelectionChange });

      const selectAll = screen.getByLabelText("Select all");
      await user.click(selectAll);

      // The onRowSelectionChange should be called with all row IDs
      expect(onSelectionChange).toHaveBeenCalledWith(
        expect.objectContaining({
          scen_1: true,
          scen_2: true,
          scen_3: true,
          scen_4: true,
          scen_5: true,
        }),
      );
    });

    it("toggles all visible scenario row checkboxes to unchecked when clicked again", async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();
      // Start with all selected
      const allSelected: RowSelectionState = {
        scen_1: true,
        scen_2: true,
        scen_3: true,
        scen_4: true,
        scen_5: true,
      };
      renderTable({
        rowSelection: allSelected,
        onRowSelectionChange: onSelectionChange,
      });

      const selectAll = screen.getByLabelText("Select all");
      await user.click(selectAll);

      // Should deselect all
      expect(onSelectionChange).toHaveBeenCalledWith({});
    });
  });

  describe("when a label filter is active", () => {
    it("select all only selects filtered rows", async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();

      // Filter by "billing" label
      renderTable({
        columnFilters: [{ id: "labels", value: ["billing"] }],
        onRowSelectionChange: onSelectionChange,
      });

      // Only "Angry double-charge refund" should be visible
      expect(screen.getByText("Angry double-charge refund")).toBeInTheDocument();
      expect(screen.queryByText("Cross-doc synthesis question")).not.toBeInTheDocument();

      const selectAll = screen.getByLabelText("Select all");
      await user.click(selectAll);

      // Only the filtered row should be selected
      expect(onSelectionChange).toHaveBeenCalledWith(
        expect.objectContaining({ scen_4: true }),
      );
      // Other scenarios should NOT be in the selection
      const lastCall = onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1]![0] as RowSelectionState;
      expect(lastCall["scen_1"]).toBeUndefined();
      expect(lastCall["scen_2"]).toBeUndefined();
      expect(lastCall["scen_3"]).toBeUndefined();
      expect(lastCall["scen_5"]).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Row Action Menu
  // --------------------------------------------------------------------------

  describe("when row action menu is opened", () => {
    it("contains an Archive option", async () => {
      const user = userEvent.setup();
      renderTable();

      const actionButton = screen.getByLabelText("Actions for Angry double-charge refund");
      await user.click(actionButton);

      await waitFor(() => {
        expect(screen.getByText("Archive")).toBeInTheDocument();
      });
    });

    it("calls onArchive with the scenario when Archive is clicked", async () => {
      const user = userEvent.setup();
      const onArchive = vi.fn();
      renderTable({ onArchive });

      const actionButton = screen.getByLabelText("Actions for Angry double-charge refund");
      await user.click(actionButton);

      await waitFor(() => {
        expect(screen.getByText("Archive")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Archive"));
      expect(onArchive).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "scen_4",
          name: "Angry double-charge refund",
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Individual Row Selection
  // --------------------------------------------------------------------------

  describe("when individual row checkbox is clicked", () => {
    it("selects that row", async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();
      renderTable({ onRowSelectionChange: onSelectionChange });

      const checkbox = screen.getByLabelText("Select SaaS documentation guidance");
      await user.click(checkbox);

      expect(onSelectionChange).toHaveBeenCalledWith(
        expect.objectContaining({ scen_2: true }),
      );
    });
  });
});

// ============================================================================
// BatchActionBar
// ============================================================================

describe("<BatchActionBar/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when no rows are selected", () => {
    it("does not render", () => {
      render(<BatchActionBar selectedCount={0} onArchive={vi.fn()} />, {
        wrapper: Wrapper,
      });

      expect(screen.queryByTestId("batch-action-bar")).not.toBeInTheDocument();
    });
  });

  describe("when rows are selected", () => {
    it("displays the selection count", () => {
      render(<BatchActionBar selectedCount={3} onArchive={vi.fn()} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("3 selected")).toBeInTheDocument();
    });

    it("displays an Archive button", () => {
      render(<BatchActionBar selectedCount={2} onArchive={vi.fn()} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Archive")).toBeInTheDocument();
    });

    it("calls onArchive when Archive button is clicked", async () => {
      const user = userEvent.setup();
      const onArchive = vi.fn();

      render(<BatchActionBar selectedCount={2} onArchive={onArchive} />, {
        wrapper: Wrapper,
      });

      await user.click(screen.getByText("Archive"));
      expect(onArchive).toHaveBeenCalledTimes(1);
    });
  });

  describe("when selection count changes", () => {
    it("updates the displayed count", () => {
      const onArchive = vi.fn();
      const { rerender } = render(
        <BatchActionBar selectedCount={2} onArchive={onArchive} />,
        { wrapper: Wrapper },
      );
      expect(screen.getByText("2 selected")).toBeInTheDocument();

      rerender(
        <ChakraProvider value={defaultSystem}>
          <BatchActionBar selectedCount={3} onArchive={onArchive} />
        </ChakraProvider>,
      );
      expect(screen.getByText("3 selected")).toBeInTheDocument();
    });
  });

  describe("when selection transitions from 1 to 0", () => {
    it("hides the batch action bar", () => {
      const { rerender } = render(
        <BatchActionBar selectedCount={1} onArchive={vi.fn()} />,
        { wrapper: Wrapper },
      );
      expect(screen.getByTestId("batch-action-bar")).toBeInTheDocument();

      rerender(
        <ChakraProvider value={defaultSystem}>
          <BatchActionBar selectedCount={0} onArchive={vi.fn()} />
        </ChakraProvider>,
      );
      expect(screen.queryByTestId("batch-action-bar")).not.toBeInTheDocument();
    });
  });
});

// ============================================================================
// ScenarioArchiveDialog
// ============================================================================

describe("<ScenarioArchiveDialog/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when archiving a single scenario", () => {
    const singleScenario = [{ id: "scen_4", name: "Angry double-charge refund" }];

    it("displays 'Archive scenario?' as the title", async () => {
      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          scenarios={singleScenario}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Archive scenario?")).toBeInTheDocument();
      });
    });

    it("displays the scenario name", async () => {
      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          scenarios={singleScenario}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Angry double-charge refund")).toBeInTheDocument();
      });
    });

    it("displays the warning message", async () => {
      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          scenarios={singleScenario}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(
          screen.getByText("Archived scenarios will no longer appear in the library."),
        ).toBeInTheDocument();
      });
    });

    it("has Cancel and Archive buttons", async () => {
      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          scenarios={singleScenario}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
        expect(screen.getByText("Archive")).toBeInTheDocument();
      });
    });

    it("calls onClose when Cancel is clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={onClose}
          onConfirm={vi.fn()}
          scenarios={singleScenario}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Cancel"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onConfirm when Archive is clicked", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={onConfirm}
          scenarios={singleScenario}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Archive")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Archive" }));

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("does not call onConfirm when Cancel is clicked", async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();

      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={onConfirm}
          scenarios={singleScenario}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Cancel"));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("when archiving multiple scenarios", () => {
    const batchScenarios = [
      { id: "scen_1", name: "Cross-doc synthesis question" },
      { id: "scen_3", name: "Failed booking escalation" },
    ];

    it("displays 'Archive 2 scenarios?' as the title", async () => {
      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          scenarios={batchScenarios}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Archive 2 scenarios?")).toBeInTheDocument();
      });
    });

    it("lists each selected scenario by name", async () => {
      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          scenarios={batchScenarios}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Cross-doc synthesis question")).toBeInTheDocument();
        expect(screen.getByText("Failed booking escalation")).toBeInTheDocument();
      });
    });

    it("displays the warning message", async () => {
      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          scenarios={batchScenarios}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(
          screen.getByText("Archived scenarios will no longer appear in the library."),
        ).toBeInTheDocument();
      });
    });

    it("has Cancel and Archive buttons", async () => {
      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          scenarios={batchScenarios}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
        expect(screen.getByText("Archive")).toBeInTheDocument();
      });
    });

    it("calls onClose when Cancel is clicked without calling onConfirm", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const onConfirm = vi.fn();

      render(
        <ScenarioArchiveDialog
          open={true}
          onClose={onClose}
          onConfirm={onConfirm}
          scenarios={batchScenarios}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Cancel"));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("when dialog is closed", () => {
    it("does not render content", () => {
      render(
        <ScenarioArchiveDialog
          open={false}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          scenarios={[]}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("Archive scenario?")).not.toBeInTheDocument();
    });
  });
});
