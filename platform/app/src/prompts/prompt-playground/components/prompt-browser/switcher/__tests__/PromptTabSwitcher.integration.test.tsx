/**
 * @vitest-environment jsdom
 *
 * Covers specs/prompts/prompt-tab-switcher.feature.
 *
 * The only boundary mocked is `usePromptTabSummary`, the hook each row uses to
 * read its prompt's title / unsaved state / version. Everything else — the Ark
 * menu, the trigger, the rows, keyboard and pointer interaction — is the real
 * thing, so these tests fail if the switcher stops rendering what it promises.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptTabSummary } from "../../tab/usePromptTabSummary";
import { usePromptTabSummary } from "../../tab/usePromptTabSummary";
import { PromptTabSwitcher } from "../PromptTabSwitcher";

vi.mock("../../tab/usePromptTabSummary", () => ({
  usePromptTabSummary: vi.fn(),
}));

const summaryOf = vi.mocked(usePromptTabSummary);

/** Sensible defaults: a saved, clean, up-to-date prompt. */
function summary(overrides: Partial<PromptTabSummary> = {}): PromptTabSummary {
  return {
    title: "Untitled",
    hasUnsavedChanges: false,
    versionNumber: 1,
    latestVersion: 1,
    isOutdated: false,
    showVersionBadge: false,
    ...overrides,
  };
}

/** Route each row's hook call to a per-tab fixture. */
function givenTabs(fixtures: Record<string, Partial<PromptTabSummary>>) {
  summaryOf.mockImplementation((tabId: string) =>
    summary({ title: tabId, ...(fixtures[tabId] ?? {}) }),
  );
}

function renderSwitcher(
  props: Partial<React.ComponentProps<typeof PromptTabSwitcher>> = {},
) {
  const onSelect = props.onSelect ?? vi.fn();
  const scrollerRef =
    props.scrollerRef ?? React.createRef<HTMLDivElement | null>();
  const utils = render(
    <ChakraProvider value={defaultSystem}>
      <PromptTabSwitcher
        tabIds={props.tabIds ?? ["summarizer", "classifier"]}
        activeTabId={props.activeTabId ?? "summarizer"}
        onSelect={onSelect}
        scrollerRef={scrollerRef}
        // The switcher only exists once the strip has run out of room, so that
        // is the default here; the fits-in-the-strip case opts out explicitly.
        isStripOverflowing={props.isStripOverflowing ?? true}
      />
    </ChakraProvider>,
  );
  return { ...utils, onSelect, scrollerRef };
}

const trigger = (count: number) =>
  screen.getByRole("button", { name: `Show ${count} open prompts` });

async function openSwitcher(count: number) {
  await userEvent.click(trigger(count));
  return screen.findByRole("menu");
}

const rowFor = (menu: HTMLElement, title: string) =>
  within(menu).getByRole("menuitem", { name: new RegExp(title) });

beforeEach(() => {
  givenTabs({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PromptTabSwitcher", () => {
  describe("given several prompts are open", () => {
    /** @scenario The switcher appears once the tabs no longer fit */
    it("reports how many prompts are open", () => {
      renderSwitcher({ tabIds: ["summarizer", "classifier"] });

      expect(trigger(2)).toBeInTheDocument();
    });

    /** @scenario Opening another prompt raises the count */
    it("raises the count when another prompt is opened", () => {
      const { rerender } = renderSwitcher({
        tabIds: ["summarizer", "classifier"],
      });

      rerender(
        <ChakraProvider value={defaultSystem}>
          <PromptTabSwitcher
            tabIds={["summarizer", "classifier", "eval-judge"]}
            activeTabId="summarizer"
            onSelect={vi.fn()}
            scrollerRef={React.createRef<HTMLDivElement | null>()}
            isStripOverflowing
          />
        </ChakraProvider>,
      );

      expect(trigger(3)).toBeInTheDocument();
    });

    /** @scenario Closing a prompt lowers the count */
    it("lowers the count and drops the row when a prompt is closed", async () => {
      const { rerender } = renderSwitcher({
        tabIds: ["summarizer", "classifier", "eval-judge"],
      });

      rerender(
        <ChakraProvider value={defaultSystem}>
          <PromptTabSwitcher
            tabIds={["summarizer", "eval-judge"]}
            activeTabId="summarizer"
            onSelect={vi.fn()}
            scrollerRef={React.createRef<HTMLDivElement | null>()}
            isStripOverflowing
          />
        </ChakraProvider>,
      );

      expect(trigger(2)).toBeInTheDocument();

      const menu = await openSwitcher(2);
      expect(
        within(menu).queryByRole("menuitem", { name: /classifier/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given every open tab still fits in the strip", () => {
    /** @scenario The switcher stays hidden while every tab still fits */
    it("hides the switcher, because it would list only what is on screen", () => {
      renderSwitcher({
        tabIds: ["summarizer", "classifier"],
        isStripOverflowing: false,
      });

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("given only one prompt is open", () => {
    /** @scenario The switcher stays out of the way for a single prompt */
    it("hides the switcher entirely", () => {
      renderSwitcher({ tabIds: ["summarizer"] });

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("given no prompt is open", () => {
    /** @scenario The switcher is not shown when no prompt is open */
    it("hides the switcher entirely", () => {
      renderSwitcher({ tabIds: [], activeTabId: undefined });

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("given more prompts are open than fit across the strip", () => {
    describe("when a prompt is chosen from the switcher", () => {
      /** @scenario Choosing a prompt that has scrolled out of view */
      it("activates the prompt and scrolls its tab into view", async () => {
        const scrollIntoView = vi.fn();
        const scroller = document.createElement("div");
        const offscreenTab = document.createElement("div");
        offscreenTab.setAttribute("data-tab-strip-id", "eval-judge");
        offscreenTab.scrollIntoView = scrollIntoView;
        scroller.appendChild(offscreenTab);

        const scrollerRef = { current: scroller };
        const { onSelect } = renderSwitcher({
          tabIds: ["summarizer", "classifier", "eval-judge"],
          activeTabId: "summarizer",
          scrollerRef,
        });

        const menu = await openSwitcher(3);
        await userEvent.click(rowFor(menu, "eval-judge"));

        expect(onSelect).toHaveBeenCalledWith("eval-judge");
        expect(scrollIntoView).toHaveBeenCalled();
      });

      /** @scenario Choosing the already-active prompt changes nothing */
      it("does not re-activate the prompt that is already active", async () => {
        const { onSelect } = renderSwitcher({
          tabIds: ["summarizer", "classifier"],
          activeTabId: "summarizer",
        });

        const menu = await openSwitcher(2);
        await userEvent.click(rowFor(menu, "summarizer"));

        expect(onSelect).not.toHaveBeenCalled();
      });
    });

    describe("when the switcher is open", () => {
      /** @scenario The switcher marks which prompt is active */
      it("marks the active prompt's row", async () => {
        renderSwitcher({
          tabIds: ["summarizer", "classifier"],
          activeTabId: "summarizer",
        });

        const menu = await openSwitcher(2);

        expect(rowFor(menu, "summarizer")).toHaveAttribute(
          "aria-current",
          "true",
        );
        expect(rowFor(menu, "classifier")).not.toHaveAttribute("aria-current");
      });

      /** @scenario A row shows the prompt's title */
      it("shows a row per open prompt, titled by the prompt", async () => {
        givenTabs({
          summarizer: { title: "summarizer" },
          classifier: { title: "classifier" },
        });
        renderSwitcher({ tabIds: ["summarizer", "classifier"] });

        const menu = await openSwitcher(2);

        expect(rowFor(menu, "summarizer")).toBeInTheDocument();
        expect(rowFor(menu, "classifier")).toBeInTheDocument();
      });

      /** @scenario A prompt that has never been saved shows a placeholder title */
      it("falls back to a placeholder title for an unsaved prompt", async () => {
        givenTabs({
          "tab-new": { title: "New Prompt" },
          classifier: { title: "classifier" },
        });
        renderSwitcher({
          tabIds: ["tab-new", "classifier"],
          activeTabId: "tab-new",
        });

        const menu = await openSwitcher(2);

        expect(rowFor(menu, "New Prompt")).toBeInTheDocument();
      });

      /** @scenario A row marks a prompt with unsaved changes */
      it("marks only the rows whose prompt has unsaved changes", async () => {
        givenTabs({
          summarizer: { title: "summarizer", hasUnsavedChanges: true },
          classifier: { title: "classifier", hasUnsavedChanges: false },
        });
        renderSwitcher({ tabIds: ["summarizer", "classifier"] });

        const menu = await openSwitcher(2);

        expect(
          within(rowFor(menu, "summarizer")).getByTestId("unsaved-indicator"),
        ).toBeInTheDocument();
        expect(
          within(rowFor(menu, "classifier")).queryByTestId("unsaved-indicator"),
        ).not.toBeInTheDocument();
      });

      /** @scenario Saving clears the unsaved marker from the row */
      it("drops the unsaved marker once the prompt is saved", async () => {
        givenTabs({
          summarizer: { title: "summarizer", hasUnsavedChanges: true },
          classifier: { title: "classifier" },
        });
        const { rerender } = renderSwitcher({
          tabIds: ["summarizer", "classifier"],
        });

        expect(
          within(rowFor(await openSwitcher(2), "summarizer")).getByTestId(
            "unsaved-indicator",
          ),
        ).toBeInTheDocument();

        // The save lands: the hook now reports a clean prompt.
        givenTabs({
          summarizer: { title: "summarizer", hasUnsavedChanges: false },
          classifier: { title: "classifier" },
        });
        rerender(
          <ChakraProvider value={defaultSystem}>
            <PromptTabSwitcher
              tabIds={["summarizer", "classifier"]}
              activeTabId="summarizer"
              onSelect={vi.fn()}
              scrollerRef={React.createRef<HTMLDivElement | null>()}
              isStripOverflowing
            />
          </ChakraProvider>,
        );

        expect(
          within(rowFor(screen.getByRole("menu"), "summarizer")).queryByTestId(
            "unsaved-indicator",
          ),
        ).not.toBeInTheDocument();
      });

      /** @scenario A row shows the version only when the prompt is behind */
      it("shows the version number only on a prompt that is behind", async () => {
        givenTabs({
          summarizer: {
            title: "summarizer",
            versionNumber: 2,
            latestVersion: 5,
            isOutdated: true,
            showVersionBadge: true,
          },
          classifier: {
            title: "classifier",
            versionNumber: 5,
            latestVersion: 5,
            showVersionBadge: false,
          },
        });
        renderSwitcher({ tabIds: ["summarizer", "classifier"] });

        const menu = await openSwitcher(2);

        expect(
          within(rowFor(menu, "summarizer")).getByText("v2"),
        ).toBeInTheDocument();
        expect(
          within(rowFor(menu, "classifier")).queryByText(/^v\d+$/),
        ).not.toBeInTheDocument();
      });

      /** @scenario A row does not offer to close or upgrade the prompt */
      it("offers navigation only, with no close or upgrade control", async () => {
        givenTabs({
          summarizer: {
            title: "summarizer",
            versionNumber: 2,
            latestVersion: 5,
            isOutdated: true,
            showVersionBadge: true,
          },
        });
        renderSwitcher({ tabIds: ["summarizer", "classifier"] });

        const row = rowFor(await openSwitcher(2), "summarizer");

        expect(within(row).queryByRole("button")).not.toBeInTheDocument();
      });
    });
  });

  describe("given prompts live in folders", () => {
    /** @scenario A switcher row shows the folder alongside the name */
    it("shows the folder alongside the name, telling same-named prompts apart", async () => {
      givenTabs({
        "tab-a": { title: "onboarding/welcome" },
        "tab-b": { title: "support/welcome" },
      });
      renderSwitcher({ tabIds: ["tab-a", "tab-b"], activeTabId: "tab-a" });

      const menu = await openSwitcher(2);

      expect(
        within(menu).getByRole("menuitem", { name: /onboarding\/welcome/ }),
      ).toBeInTheDocument();
      expect(
        within(menu).getByRole("menuitem", { name: /support\/welcome/ }),
      ).toBeInTheDocument();
    });

    /** @scenario A prompt outside any folder shows no folder */
    it("shows no folder for a prompt that lives at the top level", async () => {
      givenTabs({
        classifier: { title: "classifier" },
        "tab-b": { title: "support/welcome" },
      });
      renderSwitcher({ tabIds: ["classifier", "tab-b"] });

      const menu = await openSwitcher(2);
      const row = within(menu).getByRole("menuitem", { name: /classifier/ });

      expect(row.textContent).not.toContain("/");
    });
  });

  describe("given prompts are split across two panes", () => {
    /** @scenario Splitting a prompt into a second pane splits the switchers */
    it("shows a switcher for the pane with two prompts and none for the pane with one", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <PromptTabSwitcher
            tabIds={["summarizer", "classifier"]}
            activeTabId="summarizer"
            onSelect={vi.fn()}
            scrollerRef={React.createRef<HTMLDivElement | null>()}
            isStripOverflowing
          />
          <PromptTabSwitcher
            tabIds={["eval-judge"]}
            activeTabId="eval-judge"
            onSelect={vi.fn()}
            scrollerRef={React.createRef<HTMLDivElement | null>()}
            isStripOverflowing
          />
        </ChakraProvider>,
      );

      expect(trigger(2)).toBeInTheDocument();
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });

    /** @scenario Each pane's switcher lists only that pane's prompts */
    it("lists only the prompts belonging to its own pane", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <PromptTabSwitcher
            tabIds={["eval-judge", "regression-check", "tone-check"]}
            activeTabId="eval-judge"
            onSelect={vi.fn()}
            scrollerRef={React.createRef<HTMLDivElement | null>()}
            isStripOverflowing
          />
        </ChakraProvider>,
      );

      const menu = await openSwitcher(3);

      expect(rowFor(menu, "eval-judge")).toBeInTheDocument();
      expect(rowFor(menu, "regression-check")).toBeInTheDocument();
      expect(rowFor(menu, "tone-check")).toBeInTheDocument();
      expect(
        within(menu).queryByRole("menuitem", { name: /summarizer/ }),
      ).not.toBeInTheDocument();
    });
  });
});
