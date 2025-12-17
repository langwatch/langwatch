import { describe, it, expect } from "vitest";
import type {
  FilterOperator,
  FilterState,
  DataGridColumnDef,
  DataGridState,
  DataGridURLParams,
} from "../types";

describe("DataGrid Types", () => {
  describe("FilterOperator", () => {
    it("supports 'eq' operator for enum columns", () => {
      const operator: FilterOperator = "eq";
      expect(operator).toBe("eq");
    });

    it("supports 'contains' operator for text columns", () => {
      const operator: FilterOperator = "contains";
      expect(operator).toBe("contains");
    });
  });

  describe("FilterState", () => {
    describe("when creating a filter for enum column", () => {
      it("stores columnId, operator, and value", () => {
        const filter: FilterState = {
          columnId: "status",
          operator: "eq",
          value: "FAILED",
        };

        expect(filter.columnId).toBe("status");
        expect(filter.operator).toBe("eq");
        expect(filter.value).toBe("FAILED");
      });
    });

    describe("when creating a filter for text column", () => {
      it("stores columnId with contains operator", () => {
        const filter: FilterState = {
          columnId: "name",
          operator: "contains",
          value: "login",
        };

        expect(filter.columnId).toBe("name");
        expect(filter.operator).toBe("contains");
        expect(filter.value).toBe("login");
      });
    });
  });

  describe("DataGridColumnDef", () => {
    describe("when defining a basic column", () => {
      it("requires id and header", () => {
        const column: DataGridColumnDef<{ name: string }> = {
          id: "name",
          header: "Name",
        };

        expect(column.id).toBe("name");
        expect(column.header).toBe("Name");
      });
    });

    describe("when defining a filterable text column", () => {
      it("sets filterType to text", () => {
        const column: DataGridColumnDef<{ name: string }> = {
          id: "name",
          header: "Name",
          accessorKey: "name",
          filterable: true,
          filterType: "text",
          sortable: true,
        };

        expect(column.filterable).toBe(true);
        expect(column.filterType).toBe("text");
      });
    });

    describe("when defining a filterable enum column", () => {
      it("sets filterType to enum with enumValues", () => {
        const column: DataGridColumnDef<{ status: string }> = {
          id: "status",
          header: "Status",
          accessorKey: "status",
          filterable: true,
          filterType: "enum",
          enumValues: ["SUCCESS", "FAILED", "ERROR"],
          sortable: true,
        };

        expect(column.filterType).toBe("enum");
        expect(column.enumValues).toEqual(["SUCCESS", "FAILED", "ERROR"]);
      });
    });

    describe("when defining a column with link", () => {
      it("has linkTo function", () => {
        const column: DataGridColumnDef<{ id: string; setId: string }> = {
          id: "setId",
          header: "Scenario Set",
          accessorKey: "setId",
          linkTo: (row) => `/simulations/${row.setId}`,
        };

        expect(column.linkTo).toBeDefined();
        expect(column.linkTo?.({ id: "1", setId: "set-123" })).toBe(
          "/simulations/set-123"
        );
      });
    });

    describe("when defining column visibility", () => {
      it("supports defaultVisible property", () => {
        const column: DataGridColumnDef<{ hidden: string }> = {
          id: "hidden",
          header: "Hidden Column",
          defaultVisible: false,
        };

        expect(column.defaultVisible).toBe(false);
      });
    });

    describe("when defining column pinning", () => {
      it("supports pinned property", () => {
        const column: DataGridColumnDef<{ name: string }> = {
          id: "name",
          header: "Name",
          pinned: "left",
        };

        expect(column.pinned).toBe("left");
      });
    });
  });

  describe("DataGridURLParams", () => {
    describe("when serializing filter state to URL", () => {
      it("encodes filters as JSON string", () => {
        const filters: FilterState[] = [
          { columnId: "status", operator: "eq", value: "FAILED" },
        ];

        const params: DataGridURLParams = {
          view: "table",
          filters: JSON.stringify(filters),
          sortBy: "timestamp",
          sortOrder: "desc",
          page: 1,
          pageSize: 20,
        };

        expect(params.view).toBe("table");
        expect(JSON.parse(params.filters!)).toEqual(filters);
        expect(params.sortBy).toBe("timestamp");
        expect(params.sortOrder).toBe("desc");
      });
    });

    describe("when including column visibility", () => {
      it("stores columns as comma-separated string", () => {
        const params: DataGridURLParams = {
          columns: "name,status,timestamp",
        };

        expect(params.columns).toBe("name,status,timestamp");
        expect(params.columns?.split(",")).toEqual([
          "name",
          "status",
          "timestamp",
        ]);
      });
    });

    describe("when including groupBy", () => {
      it("stores groupBy column id", () => {
        const params: DataGridURLParams = {
          groupBy: "status",
        };

        expect(params.groupBy).toBe("status");
      });
    });

    describe("when including search", () => {
      it("stores search query", () => {
        const params: DataGridURLParams = {
          search: "login error",
        };

        expect(params.search).toBe("login error");
      });
    });
  });

  describe("DataGridState", () => {
    describe("when creating initial state", () => {
      it("has all required properties", () => {
        const state: DataGridState<{ id: string }> = {
          rows: [],
          totalCount: 0,
          isLoading: false,
          error: null,
          columns: [],
          visibleColumns: new Set(),
          columnOrder: [],
          pinnedColumns: { left: [], right: [] },
          filters: [],
          globalSearch: "",
          sorting: null,
          groupBy: null,
          page: 1,
          pageSize: 20,
          selectedRows: new Set(),
          expandedRows: new Set(),
          isExporting: false,
        };

        expect(state.rows).toEqual([]);
        expect(state.totalCount).toBe(0);
        expect(state.isLoading).toBe(false);
        expect(state.page).toBe(1);
        expect(state.pageSize).toBe(20);
      });
    });

    describe("when state has data", () => {
      it("stores rows and totalCount", () => {
        const state: DataGridState<{ id: string; name: string }> = {
          rows: [
            { id: "1", name: "Test 1" },
            { id: "2", name: "Test 2" },
          ],
          totalCount: 100,
          isLoading: false,
          error: null,
          columns: [],
          visibleColumns: new Set(["id", "name"]),
          columnOrder: ["id", "name"],
          pinnedColumns: { left: [], right: [] },
          filters: [],
          globalSearch: "",
          sorting: { columnId: "name", order: "asc" },
          groupBy: null,
          page: 1,
          pageSize: 20,
          selectedRows: new Set(),
          expandedRows: new Set(),
          isExporting: false,
        };

        expect(state.rows).toHaveLength(2);
        expect(state.totalCount).toBe(100);
        expect(state.visibleColumns.has("id")).toBe(true);
        expect(state.sorting).toEqual({ columnId: "name", order: "asc" });
      });
    });

    describe("when state has filters", () => {
      it("stores filter array", () => {
        const state: DataGridState<{ id: string }> = {
          rows: [],
          totalCount: 0,
          isLoading: false,
          error: null,
          columns: [],
          visibleColumns: new Set(),
          columnOrder: [],
          pinnedColumns: { left: [], right: [] },
          filters: [
            { columnId: "status", operator: "eq", value: "FAILED" },
            { columnId: "name", operator: "contains", value: "login" },
          ],
          globalSearch: "",
          sorting: null,
          groupBy: null,
          page: 1,
          pageSize: 20,
          selectedRows: new Set(),
          expandedRows: new Set(),
          isExporting: false,
        };

        expect(state.filters).toHaveLength(2);
        expect(state.filters[0]?.columnId).toBe("status");
        expect(state.filters[1]?.operator).toBe("contains");
      });
    });

    describe("when state has expanded rows", () => {
      it("stores expanded row IDs in Set", () => {
        const state: DataGridState<{ id: string }> = {
          rows: [],
          totalCount: 0,
          isLoading: false,
          error: null,
          columns: [],
          visibleColumns: new Set(),
          columnOrder: [],
          pinnedColumns: { left: [], right: [] },
          filters: [],
          globalSearch: "",
          sorting: null,
          groupBy: null,
          page: 1,
          pageSize: 20,
          selectedRows: new Set(),
          expandedRows: new Set(["row-1", "row-3"]),
          isExporting: false,
        };

        expect(state.expandedRows.has("row-1")).toBe(true);
        expect(state.expandedRows.has("row-2")).toBe(false);
        expect(state.expandedRows.has("row-3")).toBe(true);
      });
    });
  });
});
