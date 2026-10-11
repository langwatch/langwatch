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
