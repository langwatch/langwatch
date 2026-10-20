// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Table } from "@chakra-ui/react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListTable } from "../src/components/layout/list-table.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

const body = (
  <>
    <Table.Header>
      <Table.Row>
        <Table.ColumnHeader width="8rem">Request</Table.ColumnHeader>
        <Table.ColumnHeader width="8rem">Cost</Table.ColumnHeader>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      <Table.Row>
        <Table.Cell>req_1</Table.Cell>
        <Table.Cell>$1.20</Table.Cell>
      </Table.Row>
    </Table.Body>
  </>
);

describe("ListTable scrolling", () => {
  /** @scenario A wide table scrolls sideways in a named, focusable region */
  it("wraps a scroll x table in a labelled, focusable region", () => {
    renderWithDesignSystem(
      <ListTable scroll="x" scrollLabel="Billing events">
        {body}
      </ListTable>,
    );
    const region = screen.getByRole("region", { name: "Billing events" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(getComputedStyle(region).overflowX).toBe("auto");
    expect(region).toContainElement(screen.getByRole("table"));
  });

  /** @scenario A table inside a virtual scroller never clips */
  it("leaves overflow visible when an outer element scrolls", () => {
    renderWithDesignSystem(
      <ListTable scroll="external" stickyHeader data-testid="grid">
        {body}
      </ListTable>,
    );
    const card = screen.getByTestId("grid").parentElement;
    expect(card && getComputedStyle(card).overflow).toBe("visible");
    expect(screen.queryByRole("region")).toBeNull();
  });

  /** @scenario Column geometry survives the closed props */
  it("keeps a fixed layout, minimum width and column widths", () => {
    renderWithDesignSystem(
      <ListTable tableLayout="fixed" minWidth="40rem" data-testid="grid">
        {body}
      </ListTable>,
    );
    const table = screen.getByTestId("grid");
    expect(getComputedStyle(table).tableLayout).toBe("fixed");
    expect(getComputedStyle(table).minWidth).toBe("640px");
    expect(getComputedStyle(screen.getByRole("columnheader", { name: "Cost" })).width).toBe(
      "128px",
    );
  });

  /** @scenario Scroll x requires a label */
  it("rejects scroll x without a label at the type level", () => {
    // @ts-expect-error a focusable region needs a name
    const unnamed = <ListTable scroll="x">{body}</ListTable>;
    expect(unnamed).toBeTruthy();
  });
});
