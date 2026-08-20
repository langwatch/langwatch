/**
 * @vitest-environment jsdom
 *
 * The navigation-v2 sidebar frame and its product bodies: Quick Search
 * first, the active product's real navigation components (so the legacy
 * chrome and the new shells cannot drift), and the pinned bottom block.
 *
 * Spec: specs/navigation/product-sidebars.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/[project]";
let mockHasOpsAccess = false;

const personalTeam = {
  id: "team_p",
  name: "Personal Workspace",
  slug: "personal-ada",
  isPersonal: true,
  ownerUserId: "user_1",
  members: [{ userId: "user_1", role: "ADMIN" }],
  projects: [
    {
      id: "project_p",
      slug: "personal-ada",
      name: "Personal Workspace",
      isPersonal: true,
    },
  ],
};
const team = {
  id: "team_1",
  name: "Core",
  slug: "core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1", role: "ADMIN" }],
  projects: [
    { id: "project_1", slug: "demo", name: "Demo", isPersonal: false },
  ],
};
const organization = {
  id: "org_1",
  name: "ACME",
  members: [{ userId: "user_1", role: "ADMIN" }],
  teams: [team, personalTeam],
};

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: mockPathname,
    query: {},
    asPath: mockPathname,
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: {
      user: { id: "user_1", name: "Ada", email: "ada@acme.test" },
    },
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization,
    organizations: [organization],
    team,
    project: team.projects[0],
    hasPermission: () => true,
    isPublicRoute: false,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", async () => {
  const actual = await vi.importActual<object>("~/hooks/useFeatureFlag");
  return {
    ...actual,
    useFeatureFlag: () => ({ enabled: true, isLoading: false }),
  };
});

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({
    data: { NODE_ENV: "test", IS_SAAS: true },
  }),
}));

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: mockHasOpsAccess }),
}));

const toggleSupportChatMock = vi.fn();
vi.mock("~/utils/crispBubblePolicy", () => ({
  toggleSupportChat: () => toggleSupportChatMock(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    limits: {
      getUsage: {
        useQuery: () => ({
          data: {
            activePlan: {
              free: true,
              maxMessagesPerMonth: 10_000,
              type: "FREE",
            },
            currentMonthMessagesCount: 100,
            usageUnit: "events",
          },
        }),
      },
    },
    user: {
      isAdmin: { useQuery: () => ({ data: { isAdmin: false } }) },
    },
    annotation: {
      getPendingItemsCount: { useQuery: () => ({ data: 0 }) },
    },
    personalWorkspaceFeatures: {
      get: { useQuery: () => ({ data: undefined }) },
    },
    ops: {
      getBadgeCounts: { useQuery: () => ({ data: undefined }) },
      getDashboardSnapshot: { useQuery: () => ({ data: undefined }) },
    },
  },
}));

const commandBarOpenMock = vi.fn();
vi.mock("~/features/command-bar", () => ({
  useCommandBar: () => ({ open: commandBarOpenMock }),
}));

const trackEventMock = vi.fn();
vi.mock("~/utils/tracking", () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

import { MENU_WIDTH_EXPANDED } from "~/components/MainMenu";
import { ProductSidebar } from "../shell/ProductSidebar";
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../shell/shellLayout";

/**
 * jsdom has no scrollIntoView at all, so the menu's own call is what the
 * scroll assertions read: which entry it aimed at, and where in the
 * column it asked to put it. Removed again in afterEach.
 */
function recordScrollIntoView(): {
  element: HTMLElement;
  options?: ScrollIntoViewOptions;
}[] {
  const scrolls: { element: HTMLElement; options?: ScrollIntoViewOptions }[] =
    [];
  (
    window.HTMLElement.prototype as unknown as {
      scrollIntoView: (options?: ScrollIntoViewOptions) => void;
    }
  ).scrollIntoView = function (
    this: HTMLElement,
    options?: ScrollIntoViewOptions,
  ) {
    scrolls.push({ element: this, options });
  };
  return scrolls;
}

/**
 * jsdom reports every box at the origin, so the one measurement the reveal
 * reads is stubbed: how far each named entry sits below the top of the menu
 * it scrolls in.
 */
function stubEntryOffsets(offsets: Record<string, number>) {
  const rectAt = (top: number) => ({ ...EMPTY_RECT, top, y: top });
  window.HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ) {
    if (this.dataset.testid === "sidebar-scroll-region") return rectAt(0);
    const label = this.getAttribute("aria-label");
    return rectAt((label ? offsets[label] : undefined) ?? 0);
  } as HTMLElement["getBoundingClientRect"];
}

/**
 * Appends a child to the menu and resolves once a MutationObserver has been
 * handed that change.
 *
 * Waiting for the child to be in the DOM proves nothing: it is there the
 * moment `appendChild` returns, while the observers run later in their own
 * microtask. Observers are called in the order they were created, and the
 * menu's own observer is created first, when the column mounts. So by the
 * time this one runs, the menu has already had its chance to move.
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

const EMPTY_RECT = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  toJSON: () => ({}),
  width: 0,
  x: 0,
} as const;

function renderSidebar(surface: "me" | "llm-ops" | "gateway" | "governance") {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProductSidebar surface={surface} isCompact={false} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mockPathname = "/[project]";
  mockHasOpsAccess = false;
  commandBarOpenMock.mockReset();
  toggleSupportChatMock.mockReset();
  localStorage.clear();
});

const realGetBoundingClientRect =
  window.HTMLElement.prototype.getBoundingClientRect;

afterEach(() => {
  cleanup();
  // jsdom has no scrollIntoView; the deep-link test installs one.
  delete (window.HTMLElement.prototype as { scrollIntoView?: unknown })
    .scrollIntoView;
  window.HTMLElement.prototype.getBoundingClientRect =
    realGetBoundingClientRect;
});

describe("the product sidebar", () => {
  describe("when using the Quick Search entry", () => {
    /** @scenario Quick Search sits first and opens the command bar */
    it("opens the command bar", async () => {
      renderSidebar("llm-ops");

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Quick Search" }));

      expect(commandBarOpenMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when on an LLM Ops page", () => {
    /** @scenario The LLM Ops sidebar keeps the project sections without the Govern group */
    it("shows the project sections and no Govern group", () => {
      renderSidebar("llm-ops");

      expect(screen.getByText("Observe")).toBeInTheDocument();
      expect(screen.getByText("Test")).toBeInTheDocument();
      expect(screen.getByText("Build")).toBeInTheDocument();
      expect(screen.queryByText("Govern")).not.toBeInTheDocument();
      expect(screen.queryByText("AI Gateway")).not.toBeInTheDocument();
      expect(screen.queryByText("AI Governance")).not.toBeInTheDocument();
    });
  });

  describe("when the reader has ops access and the pin flag is on", () => {
    /** @scenario The product sidebars carry no ops section */
    it("renders no Ops section in a product sidebar", () => {
      // `useFeatureFlag` is mocked on, so the pin that would open the
      // legacy Ops section is at its most permissive here.
      mockHasOpsAccess = true;
      renderSidebar("llm-ops");

      expect(screen.queryByText("Ops")).not.toBeInTheDocument();
      expect(screen.queryByText("The Foundry")).not.toBeInTheDocument();
      expect(screen.queryByText("Deja View")).not.toBeInTheDocument();
    });
  });

  describe("when on a Me page", () => {
    /** @scenario The Me sidebar keeps the personal pages without the Govern group */
    it("shows the personal pages and no Govern group", () => {
      mockPathname = "/me";
      renderSidebar("me");

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
      mockPathname = "/gateway/virtual-keys";
      renderSidebar("gateway");

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
      mockPathname = "/governance";
      renderSidebar("governance");

      expect(screen.getByText("Overview")).toBeInTheDocument();
      expect(screen.getByText("Ingestion Sources")).toBeInTheDocument();
      expect(screen.getByText("Anomaly Rules")).toBeInTheDocument();
      expect(screen.getByText("Tool Catalog")).toBeInTheDocument();
      expect(screen.getByText("Departments")).toBeInTheDocument();
    });
  });

  describe("when a page is opened by its address", () => {
    /** @scenario "Opening a page by its address reveals its sidebar entry" */
    it("brings that page's entry into view", async () => {
      const scrolls = recordScrollIntoView();

      mockPathname = "/gateway/virtual-keys";
      renderSidebar("gateway");

      await waitFor(() => {
        expect(
          scrolls.some((scroll) =>
            scroll.element.textContent?.includes("Virtual Keys"),
          ),
        ).toBe(true);
      });
      expect(
        scrolls.every((scroll) => scroll.options?.block === "nearest"),
      ).toBe(true);
    });

    /** @scenario "Opening a page by its address reveals its sidebar entry" */
    it("scrolls the menu so that entry sits at the top of the column", async () => {
      // jsdom lays nothing out, so the entry is placed by hand: 300px
      // down a menu whose own box starts at the top of the viewport.
      stubEntryOffsets({ "Virtual Keys": 300 });

      mockPathname = "/gateway/virtual-keys";
      renderSidebar("gateway");

      await waitFor(() => {
        expect(screen.getByTestId("sidebar-scroll-region").scrollTop).toBe(300);
      });
    });

    /** @scenario "Moving inside the menu leaves the scroll where it is" */
    it("does not move the menu when another page in it is opened", async () => {
      // Budgets sits further down than Virtual Keys, so a menu that
      // revealed the newly opened page would land on a different number.
      stubEntryOffsets({ "Virtual Keys": 300, Budgets: 520 });

      mockPathname = "/gateway/virtual-keys";
      const { rerender } = renderSidebar("gateway");

      const region = screen.getByTestId("sidebar-scroll-region");
      await waitFor(() => {
        expect(region.scrollTop).toBe(300);
      });

      // Opening another page from the same menu. The column stays mounted
      // and keeps its scroll; only the entry marked as the page being
      // shown moves.
      mockPathname = "/gateway/budgets";
      rerender(
        <ChakraProvider value={defaultSystem}>
          <ProductSidebar surface="gateway" isCompact={false} />
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

    /** @scenario "A reader who scrolls the menu keeps the position they chose" */
    it("leaves the scroll alone once the reader takes over", async () => {
      stubEntryOffsets({ "Virtual Keys": 300 });

      mockPathname = "/gateway/virtual-keys";
      renderSidebar("gateway");

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
      renderSidebar("governance");

      expect(screen.getByText("Usage")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Settings" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Support" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radiogroup", { name: "Theme" }),
      ).toBeInTheDocument();
    });

    /** @scenario "A rule separates the bottom block from the pages above it" */
    it("draws a rule above the block", () => {
      renderSidebar("governance");

      const block = screen.getByTestId("sidebar-bottom-block");
      expect(block).toContainElement(
        screen.getByRole("radiogroup", { name: "Theme" }),
      );
      expect(block).toHaveStyle({ borderTopWidth: "1px" });
    });
  });

  describe("when the sidebar column renders", () => {
    /** @scenario "The sidebar draws its menu one step smaller" */
    it("is wider than the current chrome's menu", () => {
      renderSidebar("llm-ops");

      expect(Number.parseInt(SHELL_SIDEBAR_WIDTH_EXPANDED, 10)).toBeGreaterThan(
        Number.parseInt(MENU_WIDTH_EXPANDED, 10),
      );
      expect(screen.getByTestId("product-sidebar")).toHaveStyle({
        width: SHELL_SIDEBAR_WIDTH_EXPANDED,
      });
    });

    /** @scenario "The search key cap reads as a quiet hint" */
    it("gives the Quick Search key cap grey type and a hairline border", () => {
      renderSidebar("llm-ops");

      const cap = screen
        .getByRole("button", { name: "Quick Search" })
        .querySelector("kbd");
      // The hairline border is pinned on the shared chip style itself,
      // which jsdom can read where a CSS variable it cannot resolve is
      // out of reach: quietChipStyle.unit.test.ts.
      expect(cap).toHaveStyle({ color: "var(--chakra-colors-gray-400)" });
    });
  });
});
