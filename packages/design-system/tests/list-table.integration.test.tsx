// @vitest-environment jsdom

import { Table } from "@chakra-ui/react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListTable } from "../src/components/layout/list-table.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("ListTable", () => {
  describe("given headers and rows", () => {
    it("composes them into a single table", () => {
      renderWithDesignSystem(
        <ListTable>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Entries</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <Table.Row>
              <Table.Cell>production samples</Table.Cell>
              <Table.Cell>4</Table.Cell>
            </Table.Row>
          </Table.Body>
        </ListTable>,
      );

      expect(screen.getAllByRole("table")).toHaveLength(1);
      expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
      expect(screen.getByText("production samples")).toBeTruthy();
    });
  });

  describe("given a page that needs the card itself to scroll", () => {
    it("passes the caller's overrides to the container, not the table", () => {
      renderWithDesignSystem(
        <ListTable containerProps={{ id: "list-card", overflowY: "auto" }}>
          <Table.Body>
            <Table.Row>
              <Table.Cell>only row</Table.Cell>
            </Table.Row>
          </Table.Body>
        </ListTable>,
      );

      const card = document.getElementById("list-card");
      expect(card?.tagName).toBe("DIV");
      expect(card?.querySelector("table")).toBeTruthy();
      expect(screen.getByRole("table").id).toBe("");
    });
  });
});

describe("ListTable parts", () => {
  describe("given a sortable column", () => {
    it("reports the order and calls onSort on click", () => {
      const onSort = vi.fn();
      renderWithDesignSystem(
        <ListTable>
          <Table.Header>
            <Table.Row>
              <ListTable.SortHeader sorted="desc" onSort={onSort}>
                Created
              </ListTable.SortHeader>
              <ListTable.ActionHeader />
            </Table.Row>
          </Table.Header>
        </ListTable>,
      );

      const header = screen.getByRole("columnheader", { name: "Created" });
      expect(header.getAttribute("aria-sort")).toBe("descending");
      fireEvent.click(screen.getByRole("button", { name: "Created" }));
      expect(onSort).toHaveBeenCalledOnce();
      expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
    });
  });

  describe("given an id cell", () => {
    it("keeps the whole id in the title and offers a named copy button", () => {
      renderWithDesignSystem(
        <ListTable variant="embedded" containerProps={{ id: "embedded" }}>
          <Table.Body>
            <Table.Row>
              <ListTable.IdCell value="trace_abcdef0123456789" label="trace ID" />
            </Table.Row>
          </Table.Body>
        </ListTable>,
      );

      expect(screen.getByTitle("trace_abcdef0123456789")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Copy trace ID" })).toBeTruthy();
      expect(document.getElementById("embedded")?.getAttribute("data-variant")).toBe("embedded");
    });
  });
});
