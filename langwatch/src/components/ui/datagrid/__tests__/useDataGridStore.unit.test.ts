import { describe, it, expect, beforeEach } from "vitest";
import { createDataGridStore } from "../useDataGridStore";
import type { DataGridColumnDef } from "../types";

/**
 * Unit tests for DataGrid store actions.
 * Tests pure state management logic without any external dependencies.
 */
describe("useDataGridStore", () => {
  type TestRow = {
    id: string;
    name: string;
    status: string;
    timestamp: number;
  };

  const testColumns: DataGridColumnDef<TestRow>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      filterable: true,
      filterType: "text",
      sortable: true,
    },
    {
      id: "status",
      header: "Status",
      accessorKey: "status",
      filterable: true,
      filterType: "enum",
      enumValues: ["SUCCESS", "FAILED", "ERROR", "IN_PROGRESS"],
      sortable: true,
    },
    {
      id: "timestamp",
      header: "Timestamp",
      accessorKey: "timestamp",
      filterable: true,
      filterType: "date",
      sortable: true,
    },
    {
      id: "hidden",
      header: "Hidden",
      defaultVisible: false,
    },
  ];

  // Zustand store type - accessing state and actions via getState()
  let useStore: ReturnType<typeof createDataGridStore<TestRow>>;

  beforeEach(() => {
    useStore = createDataGridStore<TestRow>({
      columns: testColumns,
      getRowId: (row) => row.id,
    });
  });

  // Helper to get current state
  const getState = () => useStore.getState();

  describe("Filter Actions", () => {
    describe("addFilter", () => {
      it("adds a filter with eq operator", () => {
        getState().addFilter({
          columnId: "status",
          operator: "eq",
          value: "FAILED",
        });

        expect(getState().filters).toHaveLength(1);
        expect(getState().filters[0]).toEqual({
          columnId: "status",
          operator: "eq",
          value: "FAILED",
        });
      });

      it("adds a filter with contains operator", () => {
        getState().addFilter({
          columnId: "name",
          operator: "contains",
          value: "login",
        });

        expect(getState().filters).toHaveLength(1);
        expect(getState().filters[0]).toEqual({
          columnId: "name",
          operator: "contains",
          value: "login",
        });
      });

      it("adds a filter with eq operator for timestamps", () => {
        const timestamp = Date.now();

        getState().addFilter({
          columnId: "timestamp",
          operator: "eq",
          value: timestamp,
        });

        expect(getState().filters).toHaveLength(1);
        expect(getState().filters[0]?.operator).toBe("eq");
        expect(getState().filters[0]?.value).toEqual(timestamp);
      });

      it("resets page to 1 when adding filter", () => {
        getState().setPage(5);
        expect(getState().page).toBe(5);

        getState().addFilter({
          columnId: "status",
          operator: "eq",
          value: "FAILED",
        });

        expect(getState().page).toBe(1);
      });
    });

    describe("removeFilter", () => {
      it("removes a filter by columnId and index", () => {
        getState().addFilter({ columnId: "status", operator: "eq", value: "FAILED" });
        getState().addFilter({ columnId: "name", operator: "contains", value: "test" });

        getState().removeFilter("status", 0);

        expect(getState().filters).toHaveLength(1);
        expect(getState().filters[0]?.columnId).toBe("name");
      });
    });

    describe("setFilters", () => {
      it("replaces all filters", () => {
        getState().addFilter({ columnId: "status", operator: "eq", value: "FAILED" });

        getState().setFilters([
          { columnId: "name", operator: "contains", value: "login" },
          { columnId: "timestamp", operator: "eq", value: 1000 },
        ]);

        expect(getState().filters).toHaveLength(2);
        expect(getState().filters[0]?.columnId).toBe("name");
        expect(getState().filters[1]?.columnId).toBe("timestamp");
      });
    });

    describe("clearFilters", () => {
      it("clears all filters and search", () => {
        getState().addFilter({ columnId: "status", operator: "eq", value: "FAILED" });
        getState().setGlobalSearch("test query");

        getState().clearFilters();

        expect(getState().filters).toHaveLength(0);
        expect(getState().globalSearch).toBe("");
      });
    });

    describe("setGlobalSearch", () => {
      it("sets global search and resets page", () => {
        getState().setPage(3);
        getState().setGlobalSearch("login error");

        expect(getState().globalSearch).toBe("login error");
        expect(getState().page).toBe(1);
      });
    });
  });

  describe("Sort Actions", () => {
    describe("setSorting", () => {
      it("sets sorting with columnId and order", () => {
        getState().setSorting({ columnId: "timestamp", order: "desc" });

        expect(getState().sorting).toEqual({ columnId: "timestamp", order: "desc" });
      });

      it("clears sorting when set to null", () => {
        getState().setSorting({ columnId: "timestamp", order: "desc" });
        getState().setSorting(null);

        expect(getState().sorting).toBeNull();
      });
    });

    describe("toggleSort", () => {
      it("sets ascending order on first toggle", () => {
        getState().toggleSort("timestamp");

        expect(getState().sorting).toEqual({ columnId: "timestamp", order: "asc" });
      });

      it("toggles to descending on second toggle", () => {
        getState().toggleSort("timestamp");
        getState().toggleSort("timestamp");

        expect(getState().sorting).toEqual({ columnId: "timestamp", order: "desc" });
      });

      it("clears sorting on third toggle", () => {
        getState().toggleSort("timestamp");
        getState().toggleSort("timestamp");
        getState().toggleSort("timestamp");

        expect(getState().sorting).toBeNull();
      });

      it("does not toggle non-sortable columns", () => {
        getState().toggleSort("hidden"); // hidden column is not sortable

        expect(getState().sorting).toBeNull();
      });
    });
  });

  describe("Pagination Actions", () => {
    describe("setPage", () => {
      it("changes the current page", () => {
        getState().setPage(3);

        expect(getState().page).toBe(3);
      });
    });

    describe("setPageSize", () => {
      it("changes page size and resets to page 1", () => {
        getState().setPage(5);
        getState().setPageSize(50);

        expect(getState().pageSize).toBe(50);
        expect(getState().page).toBe(1);
      });
    });
  });

  describe("Column Actions", () => {
    describe("toggleColumnVisibility", () => {
      it("hides a visible column", () => {
        expect(getState().visibleColumns.has("name")).toBe(true);

        getState().toggleColumnVisibility("name");

        expect(getState().visibleColumns.has("name")).toBe(false);
      });

      it("shows a hidden column", () => {
        expect(getState().visibleColumns.has("hidden")).toBe(false);

        getState().toggleColumnVisibility("hidden");

        expect(getState().visibleColumns.has("hidden")).toBe(true);
      });
    });

    describe("pinColumn", () => {
      it("pins column to left", () => {
        getState().pinColumn("name", "left");

        expect(getState().pinnedColumns.left).toContain("name");
      });

      it("pins column to right", () => {
        getState().pinColumn("status", "right");

        expect(getState().pinnedColumns.right).toContain("status");
      });

      it("unpins column", () => {
        getState().pinColumn("name", "left");
        getState().pinColumn("name", false);

        expect(getState().pinnedColumns.left).not.toContain("name");
        expect(getState().pinnedColumns.right).not.toContain("name");
      });
    });
  });

  describe("Row Selection", () => {
    beforeEach(() => {
      getState().setRows([
        { id: "1", name: "Row 1", status: "SUCCESS", timestamp: Date.now() },
        { id: "2", name: "Row 2", status: "FAILED", timestamp: Date.now() },
        { id: "3", name: "Row 3", status: "ERROR", timestamp: Date.now() },
      ]);
    });

    describe("toggleRowSelection", () => {
      it("selects an unselected row", () => {
        getState().toggleRowSelection("1");

        expect(getState().selectedRows.has("1")).toBe(true);
      });

      it("deselects a selected row", () => {
        getState().toggleRowSelection("1");
        getState().toggleRowSelection("1");

        expect(getState().selectedRows.has("1")).toBe(false);
      });
    });

    describe("selectAllRows", () => {
      it("selects all rows", () => {
        getState().selectAllRows();

        expect(getState().selectedRows.size).toBe(3);
        expect(getState().selectedRows.has("1")).toBe(true);
        expect(getState().selectedRows.has("2")).toBe(true);
        expect(getState().selectedRows.has("3")).toBe(true);
      });
    });

    describe("clearSelection", () => {
      it("clears all selections", () => {
        getState().selectAllRows();
        getState().clearSelection();

        expect(getState().selectedRows.size).toBe(0);
      });
    });
  });

  describe("Row Expansion", () => {
    beforeEach(() => {
      getState().setRows([
        { id: "1", name: "Row 1", status: "SUCCESS", timestamp: Date.now() },
        { id: "2", name: "Row 2", status: "FAILED", timestamp: Date.now() },
      ]);
    });

    describe("toggleRowExpansion", () => {
      it("expands a collapsed row", () => {
        getState().toggleRowExpansion("1");

        expect(getState().expandedRows.has("1")).toBe(true);
      });

      it("collapses an expanded row", () => {
        getState().toggleRowExpansion("1");
        getState().toggleRowExpansion("1");

        expect(getState().expandedRows.has("1")).toBe(false);
      });
    });

    describe("expandAllRows", () => {
      it("expands all rows", () => {
        getState().expandAllRows();

        expect(getState().expandedRows.size).toBe(2);
      });
    });

    describe("collapseAllRows", () => {
      it("collapses all rows", () => {
        getState().expandAllRows();
        getState().collapseAllRows();

        expect(getState().expandedRows.size).toBe(0);
      });
    });
  });

  describe("resetFiltersAndSorting", () => {
    it("clears filters, search, sorting, and groupBy", () => {
      getState().addFilter({ columnId: "status", operator: "eq", value: "FAILED" });
      getState().setGlobalSearch("test");
      getState().setSorting({ columnId: "timestamp", order: "desc" });
      getState().setGroupBy("status");
      getState().setPage(5);

      getState().resetFiltersAndSorting();

      expect(getState().filters).toHaveLength(0);
      expect(getState().globalSearch).toBe("");
      expect(getState().sorting).toBeNull();
      expect(getState().groupBy).toBeNull();
      expect(getState().page).toBe(1);
    });
  });
});
