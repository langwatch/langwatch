// @vitest-environment jsdom

import { Table } from "@chakra-ui/react";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListTable } from "../src/components/layout/list-table.tsx";
import { PageLayout } from "../src/components/layout/page-layout.tsx";
import { Pagination } from "../src/components/layout/pagination.tsx";
import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

function overflowSideways(scroller: HTMLElement, { scrollLeft }: { scrollLeft: number }) {
  Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 900 });
  Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 300 });
  scroller.scrollLeft = scrollLeft;
  act(() => {
    scroller.dispatchEvent(new Event("scroll"));
  });
}

describe("narrow layouts", () => {
  /** @scenario A page header on a phone wraps its actions under the title */
  it("wraps the header and keeps the title whole", () => {
    renderWithDesignSystem(
      <PageLayout.Header data-testid="header">
        <PageLayout.Heading>Online Evaluations</PageLayout.Heading>
        <PageLayout.HeaderButton>Set up Guardrail</PageLayout.HeaderButton>
        <PageLayout.HeaderButton primary>New Online Evaluation</PageLayout.HeaderButton>
      </PageLayout.Header>,
    );

    const header = getComputedStyle(screen.getByTestId("header"));
    expect(header.flexWrap).toBe("wrap");
    expect(header.height).not.toBe("48px");
    const title = screen.getByRole("heading", { level: 1, name: "Online Evaluations" });
    expect(getComputedStyle(title).overflowWrap).toBe("break-word");
  });

  /** @scenario A list table wider than its card scrolls sideways with a fade on the hidden edge */
  it("scrolls a wide table inside its card behind an edge fade", () => {
    renderWithDesignSystem(
      <ListTable>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Run plan</Table.ColumnHeader>
            <Table.ColumnHeader>Targets</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          <Table.Row>
            <Table.Cell>Nightly regression</Table.Cell>
            <Table.Cell>Support agent</Table.Cell>
          </Table.Row>
        </Table.Body>
      </ListTable>,
    );

    const table = screen.getByRole("table");
    const scroller = table.parentElement as HTMLElement;
    expect(getComputedStyle(scroller).overflowX).toBe("auto");
    const header = screen.getByRole("columnheader", { name: "Run plan" });
    expect(getComputedStyle(header).whiteSpace).toBe("nowrap");

    const fade = (edge: string) =>
      document.querySelector(`[data-scroll-fade="${edge}"]`)?.getAttribute("data-visible");
    expect(fade("end")).toBe("false");

    overflowSideways(scroller, { scrollLeft: 0 });
    expect(fade("start")).toBe("false");
    expect(fade("end")).toBe("true");

    overflowSideways(scroller, { scrollLeft: 600 });
    expect(fade("start")).toBe("true");
    expect(fade("end")).toBe("false");
  });

  // jsdom applies no media query, so computed styles here are the phone (base) layout.
  /** @scenario On a phone the page body, the pager and every drawer use the full width */
  it("gives the page, the pager and a drawer the full phone width", () => {
    renderWithDesignSystem(
      <>
        <PageLayout.Container data-testid="page">rows</PageLayout.Container>
        <Pagination
          page={1}
          pageSize={25}
          totalCount={60}
          unitLabel="sessions"
          onPageChange={() => {}}
        />
        <Drawer.Root open={true} placement="end">
          <Drawer.Content>
            <Drawer.Body>Trace</Drawer.Body>
          </Drawer.Content>
        </Drawer.Root>
      </>,
    );

    expect(getComputedStyle(screen.getByTestId("page")).maxWidth).toBe("var(--chakra-sizes-full)");
    const pager = getComputedStyle(screen.getByTestId("pagination"));
    expect(pager.gridTemplateColumns).toBe("minmax(0, 1fr)");
    const sheet = document.querySelector<HTMLElement>("[data-part='content']");
    if (!sheet) throw new Error("drawer content panel not found");
    const style = getComputedStyle(sheet);
    expect(style.marginInlineStart).toBe("0px");
    expect(style.borderRadius).toBe("0px");
  });
});
