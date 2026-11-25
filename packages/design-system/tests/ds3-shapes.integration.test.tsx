// @vitest-environment jsdom
/** DS3 additions: primary tones, custom footers, widths, Card surfaces, LoadMore, ListTable. */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Card } from "../src/components/layout/card.tsx";
import { ListTable } from "../src/components/layout/list-table.tsx";
import { LoadMore } from "../src/components/layout/load-more.tsx";
import { Dialog } from "../src/components/overlays/dialog.tsx";
import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

/** jsdom resolves no cascade layers, so read the rules a node's classes were given. */
function rulesOf(element: Element): string {
  const css = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
  return Array.from(element.classList)
    .flatMap((name) => css.match(new RegExp(`\\.${name}\\{[^}]*\\}`, "g")) ?? [])
    .join("");
}

function primaryOf(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("primary action tones", () => {
  /** @scenario "A primary action may be neutral or green, and a destroying one stays red" */
  it("paints success green, neutral inverse, and leaves an omitted tone on the accent", () => {
    renderWithDesignSystem(
      <>
        <Dialog
          open
          onClose={vi.fn()}
          title="One"
          primaryAction={{ label: "Save", onClick: vi.fn(), tone: "success" }}
        />
        <Dialog
          open
          onClose={vi.fn()}
          title="Two"
          primaryAction={{ label: "Keep guide", onClick: vi.fn(), tone: "neutral" }}
        />
        <Dialog
          open
          onClose={vi.fn()}
          title="Three"
          primaryAction={{ label: "Plain", onClick: vi.fn() }}
        />
      </>,
    );
    expect(rulesOf(primaryOf("Save"))).toContain("green");
    const neutral = rulesOf(primaryOf("Keep guide"));
    expect(neutral).toContain("--chakra-colors-fg");
    expect(neutral).toContain("--chakra-colors-bg-panel");
    expect(rulesOf(primaryOf("Plain"))).not.toContain("green");
  });

  it("keeps a destructive primary red whatever its tone", () => {
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Delete"
        primaryAction={{ label: "Delete it", onClick: vi.fn(), danger: true, tone: "success" }}
      />,
    );
    const rules = rulesOf(primaryOf("Delete it"));
    expect(rules).toContain("red");
    expect(rules).not.toContain("green");
  });

  it("submits a form once from the primary click", () => {
    const onSubmit = vi.fn();
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Save version"
        onSubmit={onSubmit}
        primaryAction={{ label: "Save", type: "submit", tone: "success" }}
      />,
    );
    fireEvent.click(primaryOf("Save"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("the Dialog options", () => {
  /** @scenario "A dialog or drawer footer may be one node that owns its controls" */
  it("draws footerContent in place of the descriptor footer, with no extra Cancel", () => {
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Run"
        footerContent={<button type="button">Own cancel</button>}
      >
        body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Own cancel" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("keeps one accessible title when headerContent replaces the heading", () => {
    renderWithDesignSystem(
      <Dialog open onClose={vi.fn()} title="Create a scenario" headerContent={<p>With Langy</p>} />,
    );
    const dialog = screen.getByRole("dialog", { name: "Create a scenario" });
    expect(within(dialog).getByText("With Langy")).toBeTruthy();
    expect(within(dialog).getAllByText("Create a scenario")).toHaveLength(1);
    expect(within(dialog).getAllByRole("button", { name: /close/i })).toHaveLength(1);
  });

  it("closes on Escape by default and stays open when closeOnEscape is false", async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const { unmount } = renderWithDesignSystem(<Dialog open onClose={first} title="A" />);
    await user.keyboard("{Escape}");
    expect(first).toHaveBeenCalledTimes(1);
    unmount();
    const second = vi.fn();
    renderWithDesignSystem(<Dialog open onClose={second} title="B" closeOnEscape={false} />);
    await user.keyboard("{Escape}");
    expect(second).not.toHaveBeenCalled();
  });

  /** @scenario "A dialog's Escape and focus options default to the current behaviour" */
  it("never closes on Escape while busy even when closeOnEscape is true", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithDesignSystem(<Dialog open onClose={onClose} title="Busy" busy closeOnEscape />);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("names the detail width and the assistant surface", () => {
    renderWithDesignSystem(
      <Dialog open onClose={vi.fn()} title="Wide" size="detail" surface="assistant" />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-size")).toBe("detail");
    expect(rulesOf(dialog)).toContain("38.5rem");
    expect(dialog.classList.contains("langy-root")).toBe(true);
  });
});

describe("the Drawer options", () => {
  it("draws footerContent inside the one footer band and no second footer", () => {
    renderWithDesignSystem(
      <Drawer
        onClose={vi.fn()}
        title="Edit"
        footerContent={<button type="button">Save and run</button>}
      />,
    );
    const drawer = screen.getByRole("dialog", { name: "Edit" });
    expect(within(drawer).getByRole("button", { name: "Save and run" })).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(drawer.querySelectorAll("[data-drawer-footer]").length).toBeLessThanOrEqual(1);
  });

  it("draws no band for a null footerContent", () => {
    renderWithDesignSystem(<Drawer onClose={vi.fn()} title="Edit" footerContent={null} />);
    expect(
      screen.getByRole("dialog", { name: "Edit" }).querySelector("[data-drawer-footer]"),
    ).toBeNull();
  });

  /** @scenario "The detail and wide steps and the content frame are named" */
  it("gives the detail and wide steps their widths", () => {
    renderWithDesignSystem(
      <>
        <Drawer onClose={vi.fn()} title="Detail" size="detail" />
        <Drawer onClose={vi.fn()} title="Wide" size="wide" />
      </>,
    );
    expect(rulesOf(screen.getByRole("dialog", { name: "Detail" }))).toContain("38.5rem");
    expect(rulesOf(screen.getByRole("dialog", { name: "Wide" }))).toContain("59.375rem");
  });

  it("content chrome keeps one X, one name and the supplied header", () => {
    renderWithDesignSystem(
      <Drawer onClose={vi.fn()} title="Run" chrome="content" headerContent={<p>Header band</p>}>
        <p>Transcript</p>
      </Drawer>,
    );
    const drawer = screen.getByRole("dialog", { name: "Run" });
    expect(within(drawer).getByText("Header band")).toBeTruthy();
    expect(within(drawer).getByText("Transcript")).toBeTruthy();
    expect(within(drawer).getAllByRole("button", { name: /close/i })).toHaveLength(1);
  });

  it("studio-header keeps the 56px top clearance", () => {
    renderWithDesignSystem(<Drawer onClose={vi.fn()} title="Props" topInset="studio-header" />);
    const rules = rulesOf(screen.getByRole("dialog", { name: "Props" }));
    expect(rules).toContain("margin-top");
    expect(rules).toContain("3.5rem");
  });
});

describe("Card surfaces", () => {
  /** @scenario "A frame card may be invalid and a joined panel names its edge" */
  it("turns the whole frame border red when invalid, with no fill", () => {
    renderWithDesignSystem(
      <>
        <Card variant="frame" invalid data-testid="bad">
          x
        </Card>
        <Card variant="frame" invalid={false} data-testid="ok">
          x
        </Card>
      </>,
    );
    const bad = rulesOf(screen.getByTestId("bad"));
    expect(bad).toContain("--chakra-colors-border-error");
    expect(bad).toContain("transparent");
    expect(rulesOf(screen.getByTestId("ok"))).not.toContain("border-error");
  });

  it("joins a panel on its start edge with a square inner side", () => {
    renderWithDesignSystem(
      <Card variant="joined-panel" edge="start" data-testid="p">
        x
      </Card>,
    );
    const card = screen.getByTestId("p");
    expect(card.getAttribute("data-card-edge")).toBe("start");
    const rules = rulesOf(card);
    expect(rules).toContain("border-start-start-radius");
    expect(rules).toContain("border-inline-end-width:0");
  });

  /** @scenario "A nested well takes the xs padding and a muted border" */
  it("draws xs padding as an 8px inset and a muted nested border", () => {
    renderWithDesignSystem(
      <Card variant="nested" padding="xs" borderTone="muted" data-testid="well">
        x
      </Card>,
    );
    const card = screen.getByTestId("well");
    expect(card.getAttribute("data-card-padding")).toBe("xs");
    expect(rulesOf(card)).toContain("--chakra-colors-border-muted");
  });
});

describe("LoadMore labels", () => {
  it("keeps the default label and swaps visible and accessible names when asked", () => {
    const { unmount } = renderWithDesignSystem(
      <LoadMore hasMore loading={false} onLoadMore={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    unmount();
    const onLoadMore = vi.fn();
    renderWithDesignSystem(
      <LoadMore
        hasMore
        loading={false}
        onLoadMore={onLoadMore}
        label="Load older chats"
        aria-label="Load older conversations"
        appearance="compact"
      />,
    );
    const button = screen.getByRole("button", { name: "Load older conversations" });
    expect(button.textContent).toBe("Load older chats");
    fireEvent.click(button);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("refuses a repeat activation while loading", () => {
    const onLoadMore = vi.fn();
    renderWithDesignSystem(<LoadMore hasMore loading onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).not.toHaveBeenCalled();
  });
});

describe("ListTable columns and header layout", () => {
  /** @scenario "A column may omit its width and a header may grow with its content" */
  it("declares no width for an unsized column and a percentage for a sized one", () => {
    renderWithDesignSystem(
      <ListTable headerLayout="content">
        <ListTable.ColumnGroup>
          <ListTable.Column data-column="auto" />
          <ListTable.Column width="30%" data-column="pct" />
        </ListTable.ColumnGroup>
      </ListTable>,
    );
    const auto = document.querySelector("[data-column=auto]");
    const pct = document.querySelector("[data-column=pct]");
    expect(auto && rulesOf(auto)).not.toContain("width");
    expect(pct && rulesOf(pct)).toContain("30%");
  });

  it("lets the header grow when headerLayout is content", () => {
    renderWithDesignSystem(
      <ListTable headerLayout="content" aria-label="t">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>A long wrapped summary</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
      </ListTable>,
    );
    const css = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
    expect(css).toMatch(/thead th\{[^}]*height:auto/);
    expect(css).toMatch(/thead th\{[^}]*padding-block:10px|thead th\{[^}]*padding-top:10px/);
  });
});
