/// <reference types="@vitest/browser-playwright" />
/**
 * The Resource catalogue in real Chromium: focus returning to a tile, the menu button above the
 * tile's opener, and a long name at 390 pixels. jsdom has no layout, so it cannot show these.
 * @see packages/design-system/specs/pattern-resource-catalogue.feature
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { renderWithDesignSystem } from "../src/testing/index.tsx";
import {
  LONG_NAME_AGENTS,
  ResourceCatalogue,
  SEED_AGENTS,
} from "../src/workshop/resource-catalogue.example.tsx";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const SUPPORT = "Support HTTP agent";
const MINIMUM_TARGET = 24;

describe("the Resource catalogue in a browser", () => {
  /** @scenario A tile opens once from the keyboard and focus returns to it */
  it("opens one drawer on Enter and puts focus back on the tile when Escape closes it", async () => {
    await page.viewport(1280, 800);
    renderWithDesignSystem(<ResourceCatalogue />);
    const tile = await screen.findByRole("button", { name: SUPPORT });
    tile.focus();
    await userEvent.keyboard("{Enter}");

    await screen.findByRole("dialog", { name: SUPPORT });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: SUPPORT })),
    );
  });

  /** @scenario A tile menu does not open the detail */
  it("opens the menu, and not the detail, when the menu button is clicked", async () => {
    await page.viewport(1280, 800);
    renderWithDesignSystem(<ResourceCatalogue />);
    await userEvent.click(await screen.findByRole("button", { name: `Actions for ${SUPPORT}` }));

    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /** @scenario A long name stays reachable at the tile and in full in the detail */
  it("stacks the tiles at 390 pixels, keeps a long name inside its tile and the menu button tappable", async () => {
    await page.viewport(390, 844);
    renderWithDesignSystem(<ResourceCatalogue agents={LONG_NAME_AGENTS} />);
    const grid = await screen.findByTestId("agent-catalogue");
    await waitFor(() =>
      expect(within(grid).getAllByRole("button", { name: /^Actions for/ })).toHaveLength(6),
    );

    const tiles = SEED_AGENTS.map((agent) => screen.getByTestId(`agent-tile-${agent.id}`));
    const lefts = new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().left)));
    expect(lefts.size).toBe(1);
    for (const tile of tiles) {
      expect(tile.scrollWidth).toBeLessThanOrEqual(tile.clientWidth);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    const menu = within(grid).getAllByRole("button", { name: /^Actions for/ })[0] as HTMLElement;
    const box = menu.getBoundingClientRect();
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(MINIMUM_TARGET);
  });
});
