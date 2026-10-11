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
