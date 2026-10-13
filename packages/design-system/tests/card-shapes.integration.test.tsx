// @vitest-environment jsdom
/** Card, CardGrid, ResourceTile, LoadMore and the `line` empty state (ADR-002). */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Card, CardGrid } from "../src/components/layout/card.tsx";
import { LoadMore } from "../src/components/layout/load-more.tsx";
import { ResourceTile } from "../src/components/layout/resource-tile.tsx";
import { SettingsCard } from "../src/components/layout/settings-card.tsx";
import { NoDataInfoBlock } from "../src/components/states/no-data-info-block.tsx";
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

function found(element: Element | null): Element {
  if (!element) throw new Error("expected the element to be in the document");
  return element;
}

describe("Card", () => {
  describe("given every header slot and a footer", () => {
    /** @scenario "A section card draws its header slots, body and footer" */
    it("draws a heading, the dot beside the badge, the body and then the footer", () => {
      renderWithDesignSystem(
        <Card
          title="Single sign-on"
          status="ok"
          badge={<span>Active</span>}
          actions={<button type="button">Edit</button>}
          footer={<button type="button">Test connection</button>}
          data-testid="sso"
        >
          <p>Okta</p>
        </Card>,
      );

      const card = screen.getByTestId("sso");
      expect(within(card).getByRole("heading", { level: 2, name: "Single sign-on" })).toBeTruthy();
      expect(card.querySelector("[aria-hidden='true']")).toBeTruthy();
      const text = card.textContent ?? "";
      expect(text.indexOf("Okta")).toBeLessThan(text.indexOf("Test connection"));
    });
  });

  describe("given each variant and padding", () => {
    /** @scenario "A card takes only the named looks" */
    it("marks the look and padding it drew", () => {
      renderWithDesignSystem(
        <CardGrid columns={3}>
          <Card variant="showcase" padding="sm" data-testid="showcase" />
          <Card variant="frame" padding="none" data-testid="frame" />
          <Card data-testid="panel" />
        </CardGrid>,
      );

      expect(screen.getByTestId("showcase").dataset).toMatchObject({
        cardVariant: "showcase",
        cardPadding: "sm",
      });
      expect(screen.getByTestId("frame").dataset.cardVariant).toBe("frame");
      expect(screen.getByTestId("panel").dataset).toMatchObject({
        cardVariant: "panel",
        cardPadding: "md",
      });
    });
  });

  describe("given the old card's 20px space", () => {
    /** @scenario "A card can keep the old 20px space and host content that has no title" */
    it("offers lg beside md, with the content inset further", () => {
      renderWithDesignSystem(
        <CardGrid columns={2}>
          <Card padding="lg" data-testid="roomy">
            <p>Roomy body</p>
          </Card>
          <Card data-testid="regular">
            <p>Regular body</p>
          </Card>
        </CardGrid>,
      );

      expect(screen.getByTestId("roomy").dataset.cardPadding).toBe("lg");
      const inset = (testId: string, text: string) => {
        const body = within(screen.getByTestId(testId)).getByText(text).parentElement;
        return body ? getComputedStyle(body).paddingInline : "";
      };
      expect(inset("roomy", "Roomy body")).toBe("var(--chakra-spacing-5)");
      expect(inset("regular", "Regular body")).toBe("var(--chakra-spacing-4)");
    });
  });

  describe("given a tone", () => {
    /** @scenario "A nested card with a tone is a tinted well and an accent row colours only its edge" */
    it("tints a nested card's border and fill and its heading, and leaves body text plain", () => {
      renderWithDesignSystem(
        <Card variant="nested" tone="teal" title="RAG Contexts" data-testid="well">
          <p>Body</p>
        </Card>,
      );

      const well = screen.getByTestId("well");
      expect(well.dataset.cardTone).toBe("teal");
      const rules = rulesOf(well);
      expect(rules).toContain("--chakra-colors-teal-muted");
      expect(rules).toContain("--chakra-colors-teal-subtle");
      const heading = screen.getByRole("heading", { name: "RAG Contexts" });
      expect(rulesOf(heading)).toContain("--chakra-colors-teal-fg");
      expect(rulesOf(screen.getByText("Body"))).not.toContain("teal");
    });

    /** @scenario "A nested card with a tone is a tinted well and an accent row colours only its edge" */
    it("draws a neutral nested card in the plain border and subtle fill", () => {
      renderWithDesignSystem(
        <Card variant="nested" tone="neutral" padding="sm" data-testid="inset">
          <p>Context</p>
        </Card>,
      );

      const rules = rulesOf(screen.getByTestId("inset"));
      expect(rules).toContain("--chakra-colors-bg-subtle");
      expect(rules).not.toMatch(/-(red|teal|blue|yellow)-/);
    });

    /** @scenario "A nested card with a tone is a tinted well and an accent row colours only its edge" */
    it("colours only the 2px left edge of an accent row, with a gray fallback", () => {
      renderWithDesignSystem(
        <>
          <Card variant="accent-row" tone="purple" data-testid="system">
            <input aria-label="Role" />
          </Card>
          <Card variant="accent-row" data-testid="unknown" />
        </>,
      );

      const system = rulesOf(screen.getByTestId("system"));
      expect(system).toContain("border-left-width:2px");
      expect(system).toContain("border-left-color:var(--chakra-colors-purple-fg)");
      expect(system).not.toContain("purple-subtle");
      expect(rulesOf(screen.getByTestId("unknown"))).toContain("--chakra-colors-gray-fg");
      expect(screen.getByRole("textbox", { name: "Role" })).toBeTruthy();
    });

    /** @scenario "A nested card with a tone is a tinted well and an accent row colours only its edge" */
    it("draws a card with no tone as it did", () => {
      renderWithDesignSystem(<Card data-testid="plain" />);

      const plain = screen.getByTestId("plain");
      expect(plain.dataset.cardTone).toBeUndefined();
      expect(rulesOf(plain)).not.toContain("border-left-width");
    });

    /** @scenario "A toned card is a surface and never an opener" */
    it("refuses an opener on an accent row or a toned card", () => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(() =>
        renderWithDesignSystem(
          <Card variant="accent-row" opener={<a href="#x">Open</a>}>
            <p>Row</p>
          </Card>,
        ),
      ).toThrow("not an opener");
      quiet.mockRestore();
    });
  });

  describe("given the larger insets and the emphasized variant", () => {
    /** @scenario "A card names the larger insets and the emphasized variant" */
    it("insets xl 24px all round and inline-lg 24px across and 20px down", () => {
      renderWithDesignSystem(
        <>
          <Card padding="xl" data-testid="xl">
            <p>Xl body</p>
          </Card>
          <Card padding="inline-lg" data-testid="inline">
            <p>Inline body</p>
          </Card>
        </>,
      );

      const body = (text: string) => getComputedStyle(found(screen.getByText(text).parentElement));
      expect(body("Xl body").paddingInline).toBe("var(--chakra-spacing-6)");
      expect(body("Xl body").paddingTop).toBe("var(--chakra-spacing-6)");
      expect(body("Inline body").paddingInline).toBe("var(--chakra-spacing-6)");
      expect(body("Inline body").paddingTop).toBe("var(--chakra-spacing-5)");
    });

    /** @scenario "A card names the larger insets and the emphasized variant" */
    it("draws emphasized with the emphasized border, the panel ground and the 2xl radius", () => {
      renderWithDesignSystem(<Card variant="emphasized" data-testid="plan" />);

      const rules = rulesOf(screen.getByTestId("plan"));
      expect(rules).toContain("--chakra-colors-border-emphasized");
      expect(rules).toContain("--chakra-colors-bg-panel");
      expect(rules).toContain("--chakra-radii-2xl");
    });
  });

  describe("given a body layout, a placeholder and a tour target", () => {
    /** @scenario "A card lays its content out as a stack and marks a placeholder" */
    it("stacks children with no gap or 12px between them, flow leaving them in block flow", () => {
      renderWithDesignSystem(
        <CardGrid columns={3}>
          <Card bodyLayout="stack" data-testid="stack">
            <p>One</p>
          </Card>
          <Card bodyLayout="spaced" data-testid="spaced">
            <p>One</p>
          </Card>
          <Card data-testid="flow">
            <p>One</p>
          </Card>
        </CardGrid>,
      );

      const body = (testId: string) =>
        getComputedStyle(within(screen.getByTestId(testId)).getByText("One").parentElement!);
      const stack = body("stack");
      expect([stack.display, stack.flexDirection]).toEqual(["flex", "column"]);
      expect(["", "normal", "0", "0px", "var(--chakra-spacing-0)"]).toContain(stack.gap);
      const spaced = body("spaced");
      expect([spaced.display, spaced.flexDirection, spaced.gap]).toEqual([
        "flex",
        "column",
        "var(--chakra-spacing-3)",
      ]);
      expect(body("flow").display).not.toBe("flex");
    });

    /** @scenario "A card lays its content out as a stack and marks a placeholder" */
    it("draws only a placeholder's border dashed", () => {
      renderWithDesignSystem(
        <CardGrid columns={2}>
          <Card placeholder data-testid="pending" />
          <Card data-testid="reported" />
        </CardGrid>,
      );

      expect(getComputedStyle(screen.getByTestId("pending")).borderStyle).toBe("dashed");
      expect(getComputedStyle(screen.getByTestId("reported")).borderStyle).not.toBe("dashed");
    });

    /** @scenario "A card lays its content out as a stack and marks a placeholder" */
    it("puts the tour target on the same painted element as the test id", () => {
      renderWithDesignSystem(<Card data-testid="panel" data-tour="costs-panel" />);

      expect(screen.getByTestId("panel").getAttribute("data-tour")).toBe("costs-panel");
    });
  });

  describe("given content that has no title", () => {
    /** @scenario "A card can keep the old 20px space and host content that has no title" */
    it("draws a description on its own without dropping it", () => {
      renderWithDesignSystem(
        <Card description="Nothing configured yet." data-testid="described" />,
      );

      expect(
        within(screen.getByTestId("described")).getByText("Nothing configured yet."),
      ).toBeTruthy();
    });

    /** @scenario "A card can keep the old 20px space and host content that has no title" */
    it("hosts a bounded preview edge to edge with its footer", () => {
      renderWithDesignSystem(
        <Card padding="none" footer={<button type="button">Open run</button>} data-testid="preview">
          <div style={{ height: 120, overflow: "hidden" }} data-testid="frame">
            Simulation preview
          </div>
        </Card>,
      );

      const card = screen.getByTestId("preview");
      expect(within(card).getByTestId("frame").style.height).toBe("120px");
      expect(within(card).getByRole("button", { name: "Open run" })).toBeTruthy();
    });
  });

  describe("given the deprecated SettingsCard", () => {
    /** @scenario "The old settings card delegates to the card" */
    it("draws a panel card with its hint and actions", () => {
      renderWithDesignSystem(
        <SettingsCard
          title="SCIM"
          hint="Provision members from your directory."
          tone="warning"
          actions={<button type="button">Rotate token</button>}
          data-testid="scim"
        />,
      );

      const card = screen.getByTestId("scim");
      expect(card.dataset.cardVariant).toBe("panel");
      expect(within(card).getByText("Provision members from your directory.")).toBeTruthy();
      expect(within(card).getByRole("button", { name: "Rotate token" })).toBeTruthy();
    });
  });
});

describe("a linked Card", () => {
  describe("given a native link opener", () => {
    /** @scenario "A linked card has one native keyboard target and keeps browser navigation" */
    it("is one link named by its label or string title, with the caller's href", () => {
      renderWithDesignSystem(
        <CardGrid columns={2}>
          <Card
            padding="none"
            opener={
              <a href="/dashboards/1" target="_blank" rel="noopener" aria-label="Open traffic" />
            }
          >
            <p>Traffic</p>
          </Card>
          <Card
            padding="none"
            title="Latency"
            opener={<a href="/dashboards/2" aria-label="Open latency" />}
          />
          <Card
            padding="none"
            title="Errors"
            opener={createElement("a", { href: "/dashboards/3", "aria-label": undefined })}
          />
        </CardGrid>,
      );

      const links = screen.getAllByRole("link");
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        "/dashboards/1",
        "/dashboards/2",
        "/dashboards/3",
      ]);
      expect(links[0]?.getAttribute("target")).toBe("_blank");
      expect(links[0]?.getAttribute("rel")).toBe("noopener");
      expect(screen.getByRole("link", { name: "Open latency" })).toBe(links[1]);
      expect(screen.getByRole("link", { name: "Errors" })).toBe(links[2]);
    });
  });

  describe("given a button opener", () => {
    /** @scenario "A linked card has one native keyboard target and keeps browser navigation" */
    it("never submits an enclosing form and runs the caller's callback once", () => {
      const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      const onOpen = vi.fn();
      renderWithDesignSystem(
        <form onSubmit={onSubmit}>
          <Card
            padding="none"
            title="Create a dashboard"
            opener={createElement("button", { onClick: onOpen, "aria-label": undefined })}
          />
        </form>,
      );

      const opener = screen.getByRole("button", { name: "Create a dashboard" });
      expect(opener.getAttribute("type")).toBe("button");
      fireEvent.click(opener);
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("given an opener that cannot work", () => {
    /** @scenario "A linked card has one native keyboard target and keeps browser navigation" */
    it("refuses a div, and a link with no name from label, text or string title", () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(() => renderWithDesignSystem(<Card opener={<div />} title="Nope" />)).toThrow(
        /must be a link or a button/,
      );
      expect(() =>
        renderWithDesignSystem(
          <Card
            opener={createElement("a", { href: "/x", "aria-label": undefined })}
            title={<b>Rich</b>}
          />,
        ),
      ).toThrow(/needs a name/);
    });
  });

  describe("given a card with no opener", () => {
    /** @scenario "Existing cards keep their appearance when the optional capabilities are absent" */
    it("draws no opener element", () => {
      renderWithDesignSystem(<Card title="Plain" data-testid="plain" />);

      const card = screen.getByTestId("plain");
      expect(card.querySelector("[data-card-opener]")).toBeNull();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
    });
  });
});

describe("a frame-fill Card", () => {
  describe("given no padding", () => {
    /** @scenario "An editor frame fills its bounded parent without a second scroller" */
    it("marks itself frame-fill with no inset and lays its content out as a stretching column", () => {
      renderWithDesignSystem(
        <Card variant="frame-fill" data-testid="editor">
          <p>Editor</p>
        </Card>,
      );

      const card = screen.getByTestId("editor");
      expect(card.dataset).toMatchObject({ cardVariant: "frame-fill", cardPadding: "none" });
      const content = found(within(card).getByText("Editor").parentElement);
      const rules = rulesOf(content);
      expect(rules).toContain("flex-direction:column");
      expect(rules).toContain("min-height:0");
    });
  });
});

describe("ResourceTile", () => {
  describe("given a native opener and a menu", () => {
    /** @scenario "A resource tile opens from its own link while its menu stays usable" */
    it("names the opener by the title and keeps the menu a separate control", () => {
      const onOpen = vi.fn();
      const onMenu = vi.fn();
      renderWithDesignSystem(
        <ResourceTile
          icon={<span />}
          title="Support bot"
          opener={createElement("button", {
            type: "button",
            onClick: onOpen,
            "aria-label": undefined,
          })}
          menu={
            <button type="button" onClick={onMenu}>
              More actions
            </button>
          }
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Support bot" }));
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onMenu).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an opener that is not a native link or button", () => {
    /** @scenario "A resource tile accepts only a native opener and keeps its controls reachable" */
    it("refuses a div, and a bare button never submits an enclosing form", () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(() =>
        renderWithDesignSystem(
          <ResourceTile icon={<span />} title="Support bot" opener={<div />} />,
        ),
      ).toThrow(/must be a link or a button/);

      const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
      renderWithDesignSystem(
        <form onSubmit={onSubmit}>
          <ResourceTile icon={<span />} title="Billing bot" opener={createElement("button")} />
        </form>,
      );
      const opener = screen.getByRole("button", { name: "Billing bot" });
      expect(opener.getAttribute("type")).toBe("button");
      fireEvent.click(opener);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    /** @scenario "A resource tile accepts only a native opener and keeps its controls reachable" */
    it("lets a control in the badges take its own clicks while plain meta falls through", () => {
      const onBadge = vi.fn();
      renderWithDesignSystem(
        <ResourceTile
          icon={<span />}
          title="Support bot"
          opener={<a href="/bots/1">open</a>}
          meta="Updated 3 days ago"
          badges={
            <button type="button" onClick={onBadge}>
              Draft
            </button>
          }
        />,
      );

      const badge = screen.getByRole("button", { name: "Draft" });
      expect(getComputedStyle(badge).pointerEvents).toBe("auto");
      expect(
        getComputedStyle(screen.getByText("Updated 3 days ago").parentElement ?? badge)
          .pointerEvents,
      ).toBe("none");
      fireEvent.click(badge);
      expect(onBadge).toHaveBeenCalledTimes(1);
    });
  });
});

describe("LoadMore", () => {
  describe("given 50 of 212 runs loaded", () => {
    /** @scenario "An appending list shows how far it has loaded" */
    it("says so and loads more on request", () => {
      const onLoadMore = vi.fn();
      renderWithDesignSystem(
        <LoadMore
          hasMore
          loading={false}
          onLoadMore={onLoadMore}
          shown={50}
          total={212}
          unitLabel="runs"
        />,
      );

      expect(screen.getByText("Showing 50 of 212 runs")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    /** @scenario "An appending list shows how far it has loaded" */
    it("drops the button at the end and keeps the count", () => {
      renderWithDesignSystem(
        <LoadMore
          hasMore={false}
          loading={false}
          onLoadMore={vi.fn()}
          shown={212}
          total={212}
          unitLabel="runs"
        />,
      );

      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
      expect(screen.getByText("Showing 212 of 212 runs")).toBeTruthy();
    });
  });
});

describe("NoDataInfoBlock", () => {
  describe("given size line", () => {
    /** @scenario "An empty picker says so in one line" */
    it("draws one sentence and its one action", () => {
      const onClick = vi.fn();
      renderWithDesignSystem(
        <NoDataInfoBlock
          size="line"
          title="No replicas found."
          action={{ label: "Clear filters", onClick }}
          testId="empty"
        />,
      );

      expect(screen.getByTestId("empty").dataset.size).toBe("line");
      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
