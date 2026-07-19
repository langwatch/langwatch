/**
 * @vitest-environment jsdom
 *
 * The shared list table for index pages wraps Chakra's Table parts in the
 * standard bordered, gridded look. See dev/docs/best_practices/list-table.md.
 */
import { ChakraProvider, defaultSystem, Table } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListTable } from "../ListTable";

describe("ListTable", () => {
  afterEach(() => cleanup());

  describe("given headers and rows", () => {
    it("composes them into a single table", () => {
      render(
        <ChakraProvider value={defaultSystem}>
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
          </ListTable>
        </ChakraProvider>,
      );

      expect(screen.getAllByRole("table")).toHaveLength(1);
      expect(
        screen.getByRole("columnheader", { name: "Name" }),
      ).toBeInTheDocument();
      expect(screen.getByText("production samples")).toBeInTheDocument();
    });
  });
});
