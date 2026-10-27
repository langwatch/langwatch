// @vitest-environment jsdom
import { Table } from "@chakra-ui/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListTable } from "../src/components/layout/list-table.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

/** The injected rules that style this table's header cells, read off its own classes. */
function headerRules(table: Element): string {
  const css = Array.from(document.querySelectorAll("style"))
    .map((style) => style.innerHTML)
    .join("\n");
  return Array.from(table.classList)
    .flatMap((className) => {
      const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rule = new RegExp(`\\.${escaped} thead th\\{([^}]*)\\}`, "g");
      return Array.from(css.matchAll(rule)).map((match) => match[1] ?? "");
    })
    .join("\n");
}

function renderTable({ stickyHeader }: { stickyHeader?: boolean }) {
  const { container } = renderWithDesignSystem(
    <ListTable stickyHeader={stickyHeader}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Name</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        <Table.Row>
          <Table.Cell>production samples</Table.Cell>
        </Table.Row>
      </Table.Body>
    </ListTable>,
  );
  const table = container.querySelector("table");
  if (!table) throw new Error("table not rendered");
  return table;
}

describe("ListTable stickyHeader", () => {
  afterEach(cleanup);

  it("pins the header row and paints the table's ground under it", () => {
    const rules = headerRules(renderTable({ stickyHeader: true }));
    expect(rules).toContain("position:sticky");
    expect(rules).toContain("var(--list-table-ground)");
  });

  it("leaves an ordinary list's header in the flow", () => {
    expect(headerRules(renderTable({}))).not.toContain("position:sticky");
  });
});
