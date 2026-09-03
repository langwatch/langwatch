// @vitest-environment jsdom

import { Table } from "@chakra-ui/react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ListTable } from "../src/components/list-table";
import { renderWithDesignSystem } from "../src/testing";

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
