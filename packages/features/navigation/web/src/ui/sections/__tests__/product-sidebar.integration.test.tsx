/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/product-sidebars.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pendingAnnotationsCount: { data?: number } = {};
let personalWorkspaceFeatures: { data?: Record<string, boolean> } = {};
let usage: { data?: unknown } = {};

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    annotation: { getPendingItemsCount: { useQuery: () => pendingAnnotationsCount } },
    personalWorkspaceFeatures: { get: { useQuery: () => personalWorkspaceFeatures } },
    limits: { getUsage: { useQuery: () => usage } },
    ops: { getBadgeCounts: { useQuery: () => ({}) } },
    governance: {
      resolveHome: { useQuery: () => ({}) },
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    user: { getSsoStatus: { useQuery: () => ({}) } },
    featureFlag: { isEnabledForEachOrganization: { useQuery: () => ({}) } },
  },
}));

import { WithStubNavigationHost } from "../../../testing";
import { MENU_WIDTH_EXPANDED } from "../main-menu";
import { forgetMenuScrollPositions } from "../../../behavior/use-menu-scroll-position";
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../../../model/shell-layout";
import { ProductSidebar } from "../product-sidebar";

const team = {
  id: "team_1",
  name: "Core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1" }],
  projects: [{ id: "project_1", slug: "demo", name: "Demo", isPersonal: false }],
};
const personalTeam = {
  id: "team_p",
  name: "Personal Workspace",
  isPersonal: true,
  ownerUserId: "user_1",
  members: [{ userId: "user_1" }],
  projects: [
    { id: "project_p", slug: "personal-ada", name: "Personal Workspace", isPersonal: true },
  ],
};
const organization = { id: "org_1", name: "ACME", teams: [team, personalTeam] };

const commandBarOpenMock = vi.fn();

function renderSidebar({
  surface,
  pathname = "/demo",
}: {
  surface: "me" | "llm-ops" | "gateway" | "governance";
  pathname?: string;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          organization,
          organizations: [organization],
          project: team.projects[0],
          openableTeams: [team, personalTeam],
          pathname,
          permissions: ["triggers:view", "organization:view"],
          flags: { release_ui_governance_billed_cost_enabled: { enabled: true, isLoading: false } },
          commandBar: { shortcut: "⌘K", open: commandBarOpenMock, trigger: null },
        }}
      >
        <ProductSidebar surface={surface} isCompact={false} />
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
}

/**
 * jsdom has no scrollIntoView at all, so the menu's own call is what the
 * scroll assertions read: which entry it aimed at, and where in the column
 * it asked to put it. Removed again in afterEach.
 */
function recordScrollIntoView(): { element: HTMLElement; options?: ScrollIntoViewOptions }[] {
  const scrolls: { element: HTMLElement; options?: ScrollIntoViewOptions }[] = [];
  (
    window.HTMLElement.prototype as unknown as {
      scrollIntoView: (options?: ScrollIntoViewOptions) => void;
    }
  ).scrollIntoView = function (this: HTMLElement, options?: ScrollIntoViewOptions) {
    scrolls.push({ element: this, options });
  };
  return scrolls;
}

const MENU_ENTRY_HEIGHT = 32;
const EMPTY_RECT = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  toJSON: () => ({}),
  width: 0,
  x: 0,
} as const;

/**
 * jsdom lays nothing out, so the measurements the menu reads are stubbed: how
 * tall the menu's own box is, and how far each named entry sits below the top
 * of the content it scrolls through.
 */
function stubMenuLayout({
  entryOffsets,
  menuHeight,
}: {
  entryOffsets: Record<string, number>;
  menuHeight: number;
}) {
  const rectAt = ({ top, height }: { top: number; height: number }) => ({
    ...EMPTY_RECT,
    top,
    y: top,
    height,
    bottom: top + height,
  });
  window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.dataset.testid === "sidebar-scroll-region")
      return rectAt({ top: 0, height: menuHeight });
    const label = this.getAttribute("aria-label");
    const scrolled =
      document.querySelector<HTMLElement>('[data-testid="sidebar-scroll-region"]')?.scrollTop ?? 0;
    return rectAt({
      top: ((label ? entryOffsets[label] : undefined) ?? 0) - scrolled,
      height: MENU_ENTRY_HEIGHT,
    });
  } as HTMLElement["getBoundingClientRect"];
}

/**
 * Appends a child to the menu and resolves once a MutationObserver has been
 * handed that change, so the wait proves the menu's own observer already had
 * its turn rather than merely that the child landed in the DOM.
 */
async function appendChildAndAwaitMutation(region: HTMLElement) {
  await new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      observer.disconnect();
      resolve();
    });
    observer.observe(region, { childList: true, subtree: true });
    region.appendChild(document.createElement("div"));
  });
}

beforeEach(() => {
  pendingAnnotationsCount = { data: 0 };
  personalWorkspaceFeatures = { data: {} };
  usage = {
    data: {
      activePlan: { free: true, maxMessagesPerMonth: 10_000, type: "FREE" },
      currentMonthMessagesCount: 100,
      usageUnit: "events",
    },
  };
  commandBarOpenMock.mockReset();
  localStorage.clear();
  // The menu's places outlive a test, the way they outlive a page change.
  forgetMenuScrollPositions();
});

const realGetBoundingClientRect = window.HTMLElement.prototype.getBoundingClientRect;

afterEach(() => {
  cleanup();
  // jsdom has no scrollIntoView; the deep-link tests install one.
  delete (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  window.HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
});

describe("the product sidebar", () => {
  describe("when using the Quick Search entry", () => {
    /** @scenario Quick Search sits first and opens the command bar */
    it("opens the command bar", async () => {
      renderSidebar({ surface: "llm-ops" });

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Quick Search" }));

      expect(commandBarOpenMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when on an LLM Ops page", () => {
    /** @scenario The LLM Ops sidebar keeps the project sections without the Govern group */
    it("shows the project sections and no Govern group", () => {
      renderSidebar({ surface: "llm-ops" });

      expect(screen.getByText("Observe")).toBeInTheDocument();
      expect(screen.getByText("Test")).toBeInTheDocument();
      expect(screen.getByText("Build")).toBeInTheDocument();
      expect(screen.queryByText("Govern")).not.toBeInTheDocument();
      expect(screen.queryByText("AI Gateway")).not.toBeInTheDocument();
      expect(screen.queryByText("AI Governance")).not.toBeInTheDocument();
    });
  });

  describe("when the reader has ops access", () => {
    /** @scenario The product sidebars carry no ops section */
    it("renders no Ops section in a product sidebar", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <WithStubNavigationHost
            readings={{
              organization,
              organizations: [organization],
              project: team.projects[0],
              openableTeams: [team, personalTeam],
              pathname: "/demo",
              permissions: ["triggers:view", "organization:view"],
              opsAccess: { hasAccess: true, isAdmin: true },
              commandBar: { shortcut: "⌘K", open: commandBarOpenMock, trigger: null },
            }}
          >
            <ProductSidebar surface="llm-ops" isCompact={false} />
          </WithStubNavigationHost>
        </ChakraProvider>,
      );

      expect(screen.queryByText("Ops")).not.toBeInTheDocument();
      expect(screen.queryByText("The Foundry")).not.toBeInTheDocument();
      expect(screen.queryByText("Deja View")).not.toBeInTheDocument();
    });
  });

  describe("when on a Me page", () => {
    /** @scenario The Me sidebar keeps the personal pages without the Govern group */
    it("shows the personal pages and no Govern group", () => {
      renderSidebar({ surface: "me", pathname: "/me" });

      expect(screen.getByText("My Usage")).toBeInTheDocument();
      expect(screen.getByText("Sessions")).toBeInTheDocument();
      expect(screen.getByText("Pull Requests")).toBeInTheDocument();
      expect(screen.getByText("Configure")).toBeInTheDocument();
      expect(screen.queryByText("Govern")).not.toBeInTheDocument();
    });
  });

  describe("when on a Gateway page", () => {
    /** @scenario The Gateway sidebar promotes the gateway pages */
    it("lists the gateway pages from the shared registry", () => {
      renderSidebar({ surface: "gateway", pathname: "/gateway/virtual-keys" });

      expect(screen.getByText("Virtual Keys")).toBeInTheDocument();
      expect(screen.getByText("Model Providers")).toBeInTheDocument();
      expect(screen.getByText("Budgets")).toBeInTheDocument();
      expect(screen.getByText("Cache Rules")).toBeInTheDocument();
      expect(screen.getByText("Routing Policies")).toBeInTheDocument();
    });
  });

  describe("when on a Governance page", () => {
    /** @scenario The Governance sidebar promotes the governance pages */
    it("lists the governance pages from the shared registry", () => {
      renderSidebar({ surface: "governance", pathname: "/governance" });

      expect(screen.getByText("Overview")).toBeInTheDocument();
      expect(screen.getByText("Inventory")).toBeInTheDocument();
      expect(screen.getByText("Anomaly Rules")).toBeInTheDocument();
      expect(screen.getByText("People")).toBeInTheDocument();
      // The stub flags report the billed-cost placeholders on.
      expect(screen.getByText("Costs")).toBeInTheDocument();
      expect(screen.getByText("Billed")).toBeInTheDocument();
    });
  });

  describe("when a page is opened by its address", () => {
    /** @scenario "Opening a page below the fold reveals its sidebar entry" */
    it("brings that page's entry into view", async () => {
      const scrolls = recordScrollIntoView();

      renderSidebar({ surface: "gateway", pathname: "/gateway/virtual-keys" });

      await waitFor(() => {
        expect(scrolls.some((scroll) => scroll.element.textContent?.includes("Virtual Keys"))).toBe(
          true,
        );
      });
      expect(scrolls.every((scroll) => scroll.options?.block === "nearest")).toBe(true);
    });

    /** @scenario "Opening a page below the fold reveals its sidebar entry" */
    it("scrolls the menu so that entry sits at the top of the column", async () => {
      // jsdom lays nothing out, so the entry is placed by hand: 300px
      // down a menu 200px tall, which puts it below the fold.
      stubMenuLayout({ entryOffsets: { "Virtual Keys": 300 }, menuHeight: 200 });

      renderSidebar({ surface: "gateway", pathname: "/gateway/virtual-keys" });

      await waitFor(() => {
        expect(screen.getByTestId("sidebar-scroll-region").scrollTop).toBe(300);
      });
    });

    /** @scenario "Opening a page whose entry is in view leaves the menu alone" */
    it("leaves the menu at its start when the entry is already in view", async () => {
      // Where the first entries of a menu sit: below Quick Search and the
      // heading of the first group, and well inside a menu this tall.
      stubMenuLayout({ entryOffsets: { "Virtual Keys": 71 }, menuHeight: 690 });

      renderSidebar({ surface: "gateway", pathname: "/gateway/virtual-keys" });

      const region = screen.getByTestId("sidebar-scroll-region");
      await waitFor(() => {
        expect(screen.getByRole("link", { name: "Virtual Keys" })).toHaveAttribute(
          "aria-current",
          "page",
        );
      });
      // Anything above zero has taken Quick Search and the heading with it.
      expect(region.scrollTop).toBe(0);
    });

    /** @scenario "Moving inside the menu leaves the scroll where it is" */
    it("does not move the menu when another page in it is opened", async () => {
      // Budgets sits further down than Virtual Keys, so a menu that
      // revealed the newly opened page would land on a different number.
      stubMenuLayout({
        entryOffsets: { "Virtual Keys": 300, Budgets: 520 },
        menuHeight: 200,
      });

      const { rerender } = renderSidebar({ surface: "gateway", pathname: "/gateway/virtual-keys" });

      const region = screen.getByTestId("sidebar-scroll-region");
      await waitFor(() => {
        expect(region.scrollTop).toBe(300);
      });

      // Opening another page from the same menu. The column stays mounted
      // and keeps its scroll; only the entry marked as the page being
      // shown moves.
      rerender(
        <ChakraProvider value={defaultSystem}>
          <WithStubNavigationHost
            readings={{
              organization,
              organizations: [organization],
              project: team.projects[0],
              openableTeams: [team, personalTeam],
              pathname: "/gateway/budgets",
              permissions: ["triggers:view", "organization:view"],
              flags: {
                release_ui_governance_billed_cost_enabled: { enabled: true, isLoading: false },
              },
              commandBar: { shortcut: "⌘K", open: commandBarOpenMock, trigger: null },
            }}
          >
            <ProductSidebar surface="gateway" isCompact={false} />
          </WithStubNavigationHost>
        </ChakraProvider>,
      );

      await waitFor(() => {
        expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute(
          "aria-current",
          "page",
        );
      });
      expect(region.scrollTop).toBe(300);
    });

    /** @scenario "The menu keeps its place while I move around the product" */
    it("keeps the menu where the reader left it when the column is rebuilt", async () => {
      // Opening a page rebuilds the column from nothing, so the menu the
      // reader scrolled is not the menu that comes back.
      stubMenuLayout({
        entryOffsets: { "Virtual Keys": 300, Budgets: 380 },
        menuHeight: 400,
      });

      renderSidebar({ surface: "gateway", pathname: "/gateway/virtual-keys" });

      const reachedFurtherDown = 260;
      const scrolled = screen.getByTestId("sidebar-scroll-region");
      scrolled.dispatchEvent(new Event("wheel"));
      scrolled.scrollTop = reachedFurtherDown;
      scrolled.dispatchEvent(new Event("scroll"));

      // React takes the node out of the page before it tears the column
      // down, and a node out of the page reports a scroll of zero. Reading
      // the menu on the way out therefore reads the top, so the place the
      // reader reached has to be held before then.
      Object.defineProperty(scrolled, "scrollTop", {
        configurable: true,
        get: () => 0,
      });

      cleanup();
      renderSidebar({ surface: "gateway", pathname: "/gateway/budgets" });

      const rebuilt = screen.getByTestId("sidebar-scroll-region");
      await waitFor(() => {
        expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute(
          "aria-current",
          "page",
        );
      });
      expect(rebuilt.scrollTop).toBe(reachedFurtherDown);
    });

    /** @scenario "A reader who scrolls the menu keeps the position they chose" */
    it("leaves the scroll alone once the reader takes over", async () => {
      stubMenuLayout({ entryOffsets: { "Virtual Keys": 300 }, menuHeight: 200 });

      renderSidebar({ surface: "gateway", pathname: "/gateway/virtual-keys" });

      const region = screen.getByTestId("sidebar-scroll-region");
      await waitFor(() => {
        expect(region.scrollTop).toBe(300);
      });

      // The reader scrolls the menu themselves, and it keeps changing
      // under them: the gated groups are still arriving.
      region.dispatchEvent(new Event("wheel"));
      region.scrollTop = 40;
      await appendChildAndAwaitMutation(region);

      expect(region.scrollTop).toBe(40);
    });
  });

  describe("when the sidebar bottom block renders", () => {
    /** @scenario The sidebar bottom block keeps usage, settings, support and theme */
    it("holds the usage indicator, Settings, Support and the theme control", () => {
      renderSidebar({ surface: "governance", pathname: "/governance" });

      expect(screen.getByText("Usage")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Support" })).toBeInTheDocument();
      expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    });

    /** @scenario "A rule separates the bottom block from the pages above it" */
    it("draws a rule above the block", () => {
      renderSidebar({ surface: "governance", pathname: "/governance" });

      const block = screen.getByTestId("sidebar-bottom-block");
      expect(block).toContainElement(screen.getByRole("radiogroup", { name: "Theme" }));
      expect(block).toHaveStyle({ borderTopWidth: "1px" });
    });

    /** @scenario "The rule keeps the same distance from both edges of the column" */
    it("draws the rule from a box that fills the column", () => {
      renderSidebar({ surface: "governance", pathname: "/governance" });

      // A box already at the full width of its parent cannot be widened by a
      // negative margin: only its left edge moves, which is what put the rule
      // 8px from the left of the column and 16px from the right. The inset
      // belongs to the wrapper, where both edges get it. An unset logical
      // margin reads as "" here, where a set one reads as its length.
      expect(getComputedStyle(screen.getByTestId("sidebar-bottom-block")).marginInline).toBe("");
    });

    /** @scenario "The rule keeps the same distance from both edges of the column" */
    it("lines the block's entries up with the entries above them", () => {
      renderSidebar({ surface: "governance", pathname: "/governance" });

      const block = screen.getByTestId("sidebar-bottom-block");
      const inset = (element: HTMLElement) => getComputedStyle(element).paddingInline;

      // Two steps of the spacing scale to the rule and one more to the
      // entries under it, which is the one step the entries above them take.
      expect(inset(block.parentElement!)).toBe("var(--chakra-spacing-2)");
      expect(inset(block)).toBe("var(--chakra-spacing-1)");
      expect(inset(screen.getByTestId("sidebar-scroll-region"))).toBe("var(--chakra-spacing-3)");
    });

    /** @scenario "The entries are cut at the rule as they scroll under it" */
    it("ends the scrolling part at the rule and keeps the gap inside it", () => {
      renderSidebar({ surface: "governance", pathname: "/governance" });

      const block = screen.getByTestId("sidebar-bottom-block");
      const region = screen.getByTestId("sidebar-scroll-region");
      // A margin between the two is a strip the entries disappear in before
      // they reach the line. As padding inside the scrolling part, the same
      // space holds the last entry off the rule at rest and the entries
      // travel through it as the menu moves.
      expect(getComputedStyle(block).marginTop).toBe("0");
      expect(getComputedStyle(region).paddingBottom).toBe("var(--chakra-spacing-2)");
    });
  });

  describe("when the sidebar column renders", () => {
    /** @scenario "The sidebar draws its menu one step smaller" */
    it("is wider than the current chrome's menu", () => {
      renderSidebar({ surface: "llm-ops" });

      expect(Number.parseInt(SHELL_SIDEBAR_WIDTH_EXPANDED, 10)).toBeGreaterThan(
        Number.parseInt(MENU_WIDTH_EXPANDED, 10),
      );
      expect(screen.getByTestId("product-sidebar")).toHaveStyle({
        width: SHELL_SIDEBAR_WIDTH_EXPANDED,
      });
    });

    /** @scenario "The search key cap reads as a quiet hint" */
    it("gives the Quick Search key cap grey type and a hairline border", () => {
      renderSidebar({ surface: "llm-ops" });

      const cap = screen.getByRole("button", { name: "Quick Search" }).querySelector("kbd");
      // The hairline border is pinned on the shared chip style itself,
      // which jsdom can read where a CSS variable it cannot resolve is
      // out of reach: quiet-chip-style.unit.test.ts.
      expect(cap).toHaveStyle({ color: "var(--chakra-colors-gray-400)" });
    });
  });
});
