import { toaster } from "@langwatch/design-system/toaster";
/** @vitest-environment jsdom */
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import previewAnnotations from "../.storybook/preview.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";
import {
  LONG_NAME_AGENTS,
  ResourceCatalogue,
  SEED_AGENTS,
} from "../src/workshop/resource-catalogue.example.tsx";
import { resourceCatalogueSource } from "../src/workshop/resource-catalogue.source.ts";
import * as catalogueStories from "../src/workshop/resource-catalogue.stories.tsx";

beforeAll(() => {
  window.matchMedia ??= (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  toaster.remove();
});

function composedFor(mode: "light" | "dark") {
  return composeStories(catalogueStories, {
    ...previewAnnotations,
    initialGlobals: { ...previewAnnotations.initialGlobals, colorMode: mode },
  });
}

const SUPPORT = "Support HTTP agent";
const LONG_NAME = LONG_NAME_AGENTS[0]?.name ?? "";

function tileOpeners(): string[] {
  const grid = screen.queryByTestId("agent-catalogue");
  if (!grid) return [];
  return within(grid)
    .queryAllByRole("button")
    .filter((button) => !button.getAttribute("aria-label")?.startsWith("Actions for"))
    .map((button) => button.getAttribute("aria-label") ?? "");
}

const visibleStates = {
  Default: async () => {
    expect(await screen.findByRole("heading", { level: 1, name: "Agents" })).toBeTruthy();
    expect(tileOpeners()).toEqual(SEED_AGENTS.map((agent) => agent.name));
    expect(screen.getByRole("group", { name: "Filter agents by type" })).toBeTruthy();
    expect(screen.getByText("6 of 6 agents")).toBeTruthy();
  },
  Filtered: async () => {
    expect(await screen.findByRole("heading", { level: 1, name: "Agents" })).toBeTruthy();
    expect(tileOpeners()).toEqual([SUPPORT, "Delivery status lookup"]);
    expect(screen.getByText("2 of 6 agents")).toBeTruthy();
  },
  LongNames: async () => {
    expect(await screen.findByRole("button", { name: LONG_NAME })).toBeTruthy();
    expect(tileOpeners()).toHaveLength(6);
  },
  Loading: async () => {
    expect(await screen.findByRole("heading", { level: 1, name: "Agents" })).toBeTruthy();
    expect(screen.getByLabelText("Loading records").getAttribute("aria-busy")).toBe("true");
    expect(tileOpeners()).toEqual([]);
    expect(
      (screen.getByRole("searchbox", { name: "Search agents" }) as HTMLInputElement).disabled,
    ).toBe(true);
  },
  Empty: async () => {
    expect(await screen.findByText("No agents yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read about agents" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
    ).toBeTruthy();
  },
  NoResults: async () => {
    expect(await screen.findByText('No HTTP agent matches "invoices".')).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Read about agents" })).toBeTruthy();
    expect(tileOpeners()).toEqual([]);
  },
  Failed: async () => {
    expect(await screen.findByText("Couldn't load agents")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Agent troubleshooting" })).toBeTruthy();
  },
  DetailOpen: async () => {
    const drawer = await screen.findByRole("dialog", { name: SUPPORT });
    expect(within(drawer).getByRole("button", { name: "Done" })).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "Edit agent" })).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "View history" })).toBeTruthy();
    expect(within(drawer).getByText("POST https://support.example.com/api/chat")).toBeTruthy();
  },
  Narrow: async () => {
    const frame = await screen.findByTitle("Resource catalogue at 390 pixels");
    expect(frame.getAttribute("src")).toContain("patterns-resource-catalogue--default");
  },
};

describe("the Resource catalogue pattern", () => {
  describe.each(["light", "dark"] as const)("given the %s colour mode", (mode) => {
    const stories = composedFor(mode);

    it("has a test for every named story", () => {
      expect(Object.keys(stories).toSorted()).toEqual(Object.keys(visibleStates).toSorted());
    });

    describe.each(Object.entries(visibleStates))("when %s is rendered", (name, expectState) => {
      /** @scenario Every catalogue story shows its state in light and dark */
      it("shows its own state", async () => {
        const Story = stories[name as keyof typeof stories];
        render(<Story />);
        expect(document.documentElement.classList.contains(mode)).toBe(true);
        await expectState();
      });
    });
  });
});

describe("given the catalogue of six agents", () => {
  /** @scenario Filtering by type shows only that type */
  it("shows only the HTTP agents when the HTTP chip is chosen", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ResourceCatalogue />);
    await user.click(await screen.findByRole("button", { name: /^HTTP, 2 agents/ }));

    expect(tileOpeners()).toEqual([SUPPORT, "Delivery status lookup"]);
    expect(screen.getByText("2 of 6 agents")).toBeTruthy();
  });

  /** @scenario A search with no matches can be cleared */
  it("explains a search with no match and restores every agent when cleared", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ResourceCatalogue />);
    await user.type(await screen.findByRole("searchbox", { name: "Search agents" }), "zzz");

    expect(await screen.findByText('No agent matches "zzz".')).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read about agents" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
    ).toBeTruthy();
    expect(tileOpeners()).toEqual([]);

    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0] as HTMLElement);
    await waitFor(() => expect(tileOpeners()).toHaveLength(6));
    expect(
      (screen.getByRole("searchbox", { name: "Search agents" }) as HTMLInputElement).value,
    ).toBe("");
  });

  /** @scenario A tile opens once from the keyboard and focus returns to it */
  it("opens one drawer on Enter and closes it on Escape", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ResourceCatalogue />);
    const tile = await screen.findByRole("button", { name: SUPPORT });
    tile.focus();
    await user.keyboard("{Enter}");

    const drawer = await screen.findByRole("dialog", { name: SUPPORT });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(drawer).getByText("Used by")).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  /** @scenario A tile menu does not open the detail */
  it("keeps the detail shut while the actions menu is used", async () => {
    const user = userEvent.setup();
    const asked: unknown[] = [];
    renderWithDesignSystem(<ResourceCatalogue onRequest={(request) => asked.push(request)} />);
    await user.click(await screen.findByRole("button", { name: `Actions for ${SUPPORT}` }));

    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "View history" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "View history" }));
    expect(asked).toEqual([{ kind: "history", agent: SEED_AGENTS[0] }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /** @scenario A tile menu does not open the detail */
  it("says what the application would open when no handler is given", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ResourceCatalogue />);
    await user.click(await screen.findByRole("button", { name: `Actions for ${SUPPORT}` }));
    await user.click(await screen.findByRole("menuitem", { name: "View history" }));

    expect(await screen.findByText(`History of ${SUPPORT}`)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("given the detail of an agent", () => {
  /** @scenario Edit agent in the detail asks for the editor and closes the drawer */
  it("closes the drawer and requests the editor for that agent", async () => {
    const user = userEvent.setup();
    const onRequest = vi.fn();
    renderWithDesignSystem(<ResourceCatalogue start={{ openId: 3 }} onRequest={onRequest} />);
    const drawer = await screen.findByRole("dialog", { name: "Delivery status lookup" });
    await user.click(within(drawer).getByRole("button", { name: "Edit agent" }));

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith({ kind: "edit", agent: SEED_AGENTS[2] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("given the agents failed to load", () => {
  /** @scenario A failed load can be retried and leads to the docs */
  it("shows the agents after Try again", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ResourceCatalogue start={{ view: "failed" }} />);
    expect(await screen.findByRole("link", { name: "Agent troubleshooting" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(tileOpeners()).toHaveLength(6));
  });
});

describe("given no agents", () => {
  /** @scenario An empty catalogue says where to start */
  it("offers a docs page and a prompt for a coding agent", async () => {
    renderWithDesignSystem(<ResourceCatalogue agents={[]} />);
    const docs = await screen.findByRole("link", { name: "Read about agents" });
    expect(docs.getAttribute("href")).toMatch(/^https:\/\/docs\.langwatch\.ai\//);
    expect(
      screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
    ).toBeTruthy();
  });
});

describe("given an agent with a very long name", () => {
  /** @scenario A long name stays reachable at the tile and in full in the detail */
  it("names the tile in full and shows the whole name in the detail", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ResourceCatalogue agents={LONG_NAME_AGENTS} />);
    await user.click(await screen.findByRole("button", { name: LONG_NAME }));

    const drawer = await screen.findByRole("dialog", { name: LONG_NAME });
    expect(within(drawer).getByText(LONG_NAME)).toBeTruthy();
  });
});

describe("given the source of the example", () => {
  /** @scenario The example uses only public design system entry points */
  it("imports no Chakra, Emotion or design system file by relative path", () => {
    const specifiers = [
      ...resourceCatalogueSource.matchAll(/^import [^;]*? from "([^"]+)";/gm),
    ].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(5);
    for (const specifier of specifiers) {
      const allowed =
        specifier === "react" || specifier?.startsWith("@langwatch/design-system/") === true;
      expect(allowed, `${specifier} is not a public entry point`).toBe(true);
    }
  });
});
