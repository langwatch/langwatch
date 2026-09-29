// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Table, type TableColumn } from "../table.tsx";

type Service = { name: string; host: string };

const columns: TableColumn<Service>[] = [
  { key: "name", header: "Service", cell: (row) => row.name },
  { key: "host", header: "Host", cell: (row) => row.host, mono: true },
];

const bodyRows = () => screen.getAllByRole("row").slice(1);

describe("Table", () => {
  afterEach(() => cleanup());

  describe("when there are no rows", () => {
    it("renders one row spanning every column with the empty text", () => {
      render(
        <Table columns={columns} rows={[]} rowKey={(row) => row.name} empty="No services yet." />,
      );

      const [emptyRow] = bodyRows();
      const cell = emptyRow?.querySelector("td");
      expect(bodyRows()).toHaveLength(1);
      expect(cell?.textContent).toBe("No services yet.");
      expect(cell?.getAttribute("colspan")).toBe("2");
    });
  });

  describe("when a cell holds a string", () => {
    it("carries the full value as its title for truncation", () => {
      const host = "app.a-very-long-worktree-slug.langwatch.localhost";
      render(<Table columns={columns} rows={[{ name: "ui", host }]} rowKey={(row) => row.name} />);

      expect(screen.getByRole("cell", { name: host }).getAttribute("title")).toBe(host);
    });
  });

  describe("when rows are clickable", () => {
    it("activates a row by click and by Enter", () => {
      const onRowClick = vi.fn();
      const rows = [{ name: "api", host: "api.localhost" }];
      render(
        <Table columns={columns} rows={rows} rowKey={(row) => row.name} onRowClick={onRowClick} />,
      );

      const [row] = bodyRows();
      if (!row) throw new Error("no body row rendered");
      fireEvent.click(row);
      fireEvent.keyDown(row, { key: "Enter" });

      expect(onRowClick).toHaveBeenCalledTimes(2);
      expect(onRowClick).toHaveBeenCalledWith(rows[0]);
    });
  });
});
