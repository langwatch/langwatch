// @vitest-environment jsdom
/** DS4 additions: dialog frame options, drawer workspace, banded and image cards, pagination. */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Card } from "../src/components/layout/card.tsx";
import { Pagination } from "../src/components/layout/pagination.tsx";
import { Dialog } from "../src/components/overlays/dialog.tsx";
import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

function rulesOf(element: Element): string {
  const css = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
  return Array.from(element.classList)
    .flatMap((name) => css.match(new RegExp(`\\.${name}\\{[^}]*\\}`, "g")) ?? [])
    .join("");
}

describe("dialog frame options", () => {
  /** @scenario "A dialog header band, reading height, document width and glass are named" */
  it("names the document width, the reading cap, the muted band and the glass fill", () => {
    renderWithDesignSystem(
      <Dialog
        open
        onClose={vi.fn()}
        title="Expanded text"
        size="document"
        heightLimit="reading"
        headerAppearance="muted"
        surface="glass"
        headerContent={<span>Formatted</span>}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-size")).toBe("document");
    expect(rulesOf(dialog)).toContain("min(64rem");
    expect(rulesOf(dialog)).toContain("min(85vh");
    expect(rulesOf(dialog)).toContain("backdrop-filter");
    const band = document.querySelector('[data-header-appearance="muted"]');
    expect(band).not.toBeNull();
    expect(rulesOf(band as Element)).toContain("bg-muted");
  });

  /** @scenario "A dialog header band, reading height, document width and glass are named" */
  it("refuses glass on the panel ground", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      renderWithDesignSystem(
        <Dialog open onClose={vi.fn()} title="Share" surface="glass" ground="panel" />,
      ),
    ).toThrow(/glass/);
    quiet.mockRestore();
  });

  /** @scenario "A dialog can hide its X and name a caller-owned description" */
  it("hides the X yet still closes on Escape and names the description", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithDesignSystem(
      <Dialog
        open
        onClose={onClose}
        title="Name lens"
        showCloseButton={false}
        descriptionId="own-description"
        headerContent={<p id="own-description">Pick a name</p>}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    expect(dialog.getAttribute("aria-describedby")).toBe("own-description");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("drawer workspace", () => {
  /** @scenario "A drawer has a workspace width, an Escape guard and a raised footer" */
  it("is 87.5rem wide and keeps Escape while the guard answers false", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    let allow = false;
    renderWithDesignSystem(
      <Drawer
        onClose={onClose}
        title="Add record"
        size="workspace"
        closeOnEscape={() => allow}
        footerAppearance="raised"
        footerContent={<button type="button">Add</button>}
      >
        body
      </Drawer>,
    );
    const drawer = screen.getByRole("dialog");
    expect(drawer.getAttribute("data-size")).toBe("workspace");
    expect(rulesOf(drawer)).toContain("87.5rem");
    expect(document.querySelector('[data-appearance="raised"]')).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    allow = true;
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("card variants", () => {
  /** @scenario "A banded card, a panel-fill card and an image frame are named variants" */
  it("paints each band tone from its own subtle and foreground roles", () => {
    renderWithDesignSystem(
      <>
        {(["blue", "purple", "teal", "amber", "pink", "gray"] as const).map((tone) => (
          <Card key={tone} variant="banded" bandTone={tone} title={tone}>
            keys
          </Card>
        ))}
      </>,
    );
    for (const tone of ["pink", "gray", "amber"]) {
      const band = screen.getByText(tone).closest("[data-card-band]") as Element;
      expect(rulesOf(band)).toMatch(new RegExp(`${tone}[-.]subtle`));
      expect(rulesOf(band)).toMatch(new RegExp(`${tone}[-.]fg`));
    }
    expect(document.querySelectorAll('[data-card-variant="banded"]')).toHaveLength(6);
  });

  /** @scenario "A banded card, a panel-fill card and an image frame are named variants" */
  it("draws the image frame on the subtle ground and refuses an opener", () => {
    renderWithDesignSystem(
      <Card variant="image-frame">
        <img alt="Setup" src="data:," />
      </Card>,
    );
    const frame = document.querySelector('[data-card-variant="image-frame"]') as Element;
    expect(rulesOf(frame)).toContain("bg-subtle");
    cleanup();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      renderWithDesignSystem(
        <Card variant="banded" bandTone="blue" title="x" opener={<a href="/x">x</a>}>
          y
        </Card>,
      ),
    ).toThrow(/opener/);
    quiet.mockRestore();
  });
});

describe("pagination presentation", () => {
  /** @scenario "Pagination may centre, sit on the card ground and replace its total summary" */
  it("replaces the total, centres the tracks and uses the card ground and subtle tone", () => {
    renderWithDesignSystem(
      <Pagination
        page={1}
        pageSize={25}
        totalCount={120}
        onPageChange={vi.fn()}
        unitLabel="traces"
        totalSummary="About 120 traces"
        layout="center"
        ground="card"
        summaryTone="subtle"
      />,
    );
    const bar = screen.getByTestId("pagination");
    const summary = screen.getByTestId("pagination-indicator").textContent ?? "";
    expect(summary).toContain("About 120 traces");
    expect(summary.startsWith("About 120 traces")).toBe(true);
    expect(rulesOf(bar)).toContain("minmax(max-content, 1fr) auto minmax(0, 1fr)");
    expect(rulesOf(bar)).toContain("bg-card");
  });
});
