/**
 * @vitest-environment jsdom
 *
 * The Settings surface inside the navigation-v2 shell, rendered through
 * the real SettingsLayout so the seam is exercised end to end: the back
 * entry, the regrouped iconed menu with its gates, the static top-bar
 * title, and the unchanged legacy chrome when the device stays on the
 * legacy mode.
 *
 * The internal ops pages take the same surface, so their seam is here
 * too: they render through the real DashboardLayout, which is what an
 * ops page wraps itself in.
 *
 * Specs: specs/navigation/settings-shell-v2.feature,
 *        specs/navigation/ops-navigation-v2.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/settings";
let mockIsEnterprise = true;
let mockIsLiteMember = false;
let mockHasPermission: (permission: string) => boolean = () => true;
let mockHasOpsAccess = false;
let mockIsAdmin = false;
const pushMock = vi.fn().mockResolvedValue(true);

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
  teams: [team],
};

// The real resolver, so `router.pathname` carries the route pattern here
// exactly as it does in the app. Returning the address instead hid a bug
// where the settings menu matched its entries against the pattern: one
// `/settings/*` pattern covers nearly every settings page, so none matched.
const { resolvePathname } = await vi.hoisted(
  async () =>
    await vi.importActual<typeof import("~/utils/compat/next-router")>(
      "~/utils/compat/next-router",
    ),
);

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: resolvePathname(mockPathname),
    query: {},
    asPath: mockPathname,
    push: pushMock,
    replace: vi.fn(),
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("~/utils/compat/next-head", () => ({
  default: () => null,
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: {
      user: { id: "user_1", name: "Ada", email: "ada@acme.test" },
    },
  }),
}));

// Only the hook is stubbed. The access helpers beside it are pure, and the
// fixture holds the membership rows they read, so the real ones answer.
vi.mock("~/hooks/useOrganizationTeamProject", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization,
    organizations: [organization],
    team,
    project: team.projects[0],
    organizationRole: "ADMIN",
    hasPermission: (permission: string) => mockHasPermission(permission),
  }),
}));

vi.mock("~/hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: () => ({ isLiteMember: mockIsLiteMember }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: mockIsEnterprise, isLoading: false }),
}));

vi.mock("~/hooks/useFeatureFlag", async () => {
  const actual = await vi.importActual<object>("~/hooks/useFeatureFlag");
  return {
    ...actual,
    useFeatureFlag: () => ({ enabled: true, isLoading: false }),
  };
});

const trackEventMock = vi.fn();
vi.mock("~/utils/tracking", () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div data-testid="loading-screen" />,
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({
    data: {
      NODE_ENV: "test",
      IS_SAAS: true,
      HAS_LANGWATCH_NLP_SERVICE: true,
      HAS_LANGEVALS_ENDPOINT: true,
    },
  }),
}));

vi.mock("~/hooks/usePlanManagementUrl", () => ({
  usePlanManagementUrl: () => ({ url: "" }),
}));

vi.mock("~/hooks/usePostHogIdentify", () => ({
  usePostHogIdentify: () => undefined,
}));

vi.mock("~/hooks/useOrgQueryParamSelection", () => ({
  useOrgQueryParamSelection: () => undefined,
}));

vi.mock("~/hooks/useSavedViews", () => ({
  SavedViewsProvider: ({ children }: PropsWithChildren) => <>{children}</>,
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: mockHasOpsAccess }),
}));

vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (selector: (state: unknown) => unknown) =>
    selector({
      dockShifted: false,
      claimDockShell: () => undefined,
      releaseDockShell: () => undefined,
    }),
}));

vi.mock("~/utils/crispBubblePolicy", () => ({
  toggleSupportChat: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    limits: {
      getUsage: { useQuery: () => ({ data: undefined }) },
    },
    user: {
      getSsoStatus: { useQuery: () => ({ data: undefined }) },
      isAdmin: { useQuery: () => ({ data: { isAdmin: mockIsAdmin } }) },
      // The dashboard shell mounts the secure-account nudge and the
      // organization's second-factor gate on every page, settings included,
      // so a mock that names neither takes the whole shell down.
      secureAccountNudge: { useQuery: () => ({ data: undefined }) },
      dismissSecureAccountNudge: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    twoStepVerification: {
      standing: { useQuery: () => ({ data: undefined }) },
    },
    auth: {
      myAddressConfirmation: { useQuery: () => ({ data: undefined }) },
      sendMyAddressConfirmation: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    joinRequests: {
      offer: { useQuery: () => ({ data: undefined }) },
      dismissOffer: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    useUtils: () => ({
      user: { secureAccountNudge: { invalidate: vi.fn() } },
      joinRequests: { offer: { invalidate: vi.fn() } },
    }),
    governance: {
      recordWorkspaceView: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
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
    featureFlag: {
      isEnabledForEachOrganization: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

const commandBarOpenMock = vi.fn();
vi.mock("~/features/command-bar", () => ({
  CommandBarTrigger: () => null,
  useCommandBar: () => ({ open: commandBarOpenMock }),
}));

vi.mock("~/features/traces-v2/components/GlobalTraceV2DrawerMount", () => ({
  GlobalTraceV2DrawerMount: () => null,
}));

vi.mock("~/components/CurrentDrawer", () => ({ CurrentDrawer: () => null }));
vi.mock("~/components/AnnouncementBanner", () => ({
  AnnouncementBanner: () => null,
}));
vi.mock("~/components/UpgradeModal", () => ({
  GlobalUpgradeModal: () => null,
}));
vi.mock("~/components/SavedViewsBar", () => ({
  SavedViewsBar: () => null,
}));
vi.mock("~/components/governance/AdminViewingAsBanner", () => ({
  AdminViewingAsBanner: () => null,
}));
vi.mock("~/components/WorkspaceSwitcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));
vi.mock("../../../../ee/admin/ImpersonationBanner", () => ({
  ImpersonationBanner: () => null,
}));
vi.mock("../../../../ee/admin/ImpersonationSwitchBackMenuItem", () => ({
  ImpersonationSwitchBackMenuItem: () => null,
}));
vi.mock("~/components/sidebar/PresenceMenuItem", () => ({
  PresenceMenuItem: () => null,
}));

import { DashboardLayout } from "~/components/DashboardLayout";
import SettingsLayout from "~/components/SettingsLayout";
import { useNavigationModeStore } from "~/features/navigation/navigationModeStore";
import { captureSettingsReturnPath } from "../logic/resolveSettingsBackTarget";

function renderSettings() {
  return render(
    // A router around it, because the shell mounts banners of its own — the
    // secure-account nudge among them — and one of those navigates. Without a
    // router the shell throws before any menu is drawn, which reads as every
    // assertion in this file failing at once.
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <SettingsLayout>
          <div data-testid="settings-page-content" />
        </SettingsLayout>
      </ChakraProvider>
    </MemoryRouter>,
  );
}

/** What an ops page wraps itself in, under the address it is opened at. */
function renderOpsPage(pathname: string) {
  mockPathname = pathname;
  return render(
    <ChakraProvider value={defaultSystem}>
      <DashboardLayout>
        <div data-testid="ops-page-content" />
      </DashboardLayout>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mockPathname = "/settings";
  mockIsEnterprise = true;
  mockIsLiteMember = false;
  mockHasPermission = () => true;
  mockHasOpsAccess = false;
  mockIsAdmin = false;
  pushMock.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  useNavigationModeStore.setState({ storedMode: "product-switcher" });
});

afterEach(() => {
  cleanup();
});

describe("the settings shell in a new navigation mode", () => {
  describe("when Settings was entered from a Gateway page", () => {
    /** @scenario The Settings sidebar opens with the way back */
    it("opens with the back entry, then Quick Search", () => {
      captureSettingsReturnPath({
        organizationId: organization.id,
        pathname: "/gateway/budgets",
      });
      renderSettings();

      const back = screen.getByRole("link", { name: "Back to Gateway" });
      expect(back).toHaveAttribute("href", "/gateway/budgets");
      expect(
        screen.getByRole("button", { name: "Quick Search" }),
      ).toBeInTheDocument();
    });
  });

  describe("when the settings menu renders in a v2 mode", () => {
    /** @scenario The settings menu is grouped with its gates kept */
    it("shows the groups with the current addresses", () => {
      renderSettings();

      expect(screen.getByText("Organization")).toBeInTheDocument();
      expect(screen.getByText("People & access")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
        "href",
        "/settings",
      );
      expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute(
        "href",
        "/settings/members",
      );
      expect(screen.getByTestId("settings-page-content")).toBeInTheDocument();
    });

    /** @scenario The You section comes first and is about the reader */
    it("opens the menu with the reader's own two pages", () => {
      renderSettings();

      const you = screen.getByText("You");
      const organization = screen.getByText("Organization");
      expect(
        you.compareDocumentPosition(organization) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      const profile = screen.getByRole("link", { name: "Profile" });
      const security = screen.getByRole("link", { name: "Security" });
      expect(profile).toHaveAttribute("href", "/settings/profile");
      expect(security).toHaveAttribute("href", "/settings/security");
      expect(
        profile.compareDocumentPosition(security) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    /** @scenario The personal pages ask for no organization permission */
    it("offers Profile and Security to a reader who holds no permission", () => {
      mockHasPermission = () => false;
      renderSettings();

      expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Security" }),
      ).toBeInTheDocument();
    });

    /** @scenario The access group is named for people and holds the organization's pages */
    it("names the group People & access and drops the entries that became tabs", () => {
      renderSettings();

      expect(screen.getByText("People & access")).toBeInTheDocument();
      // Role Bindings became a tab of Roles and Groups became a tab of
      // Directory, so neither has an entry of its own — both addresses still
      // resolve, they just are not offered twice.
      expect(
        screen.queryByRole("link", { name: "Role Bindings" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Groups" }),
      ).not.toBeInTheDocument();
      // Authentication is the reader's own page now, and it is called
      // Security, under You.
      expect(
        screen.queryByRole("link", { name: "Authentication" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Roles" })).toHaveAttribute(
        "href",
        "/settings/roles",
      );
      expect(screen.getByRole("link", { name: "Directory" })).toHaveAttribute(
        "href",
        "/settings/directory",
      );
      expect(screen.getByRole("link", { name: "Access" })).toHaveAttribute(
        "href",
        "/settings/access",
      );
    });

    /** @scenario The access group is named for people and holds the organization's pages */
    it("offers Access on every plan, since only one of its cards is enterprise", () => {
      mockIsEnterprise = false;
      renderSettings();

      expect(screen.getByRole("link", { name: "Access" })).toBeInTheDocument();
    });

    /** @scenario "Enterprise entries carry a quiet grey pill" */
    it("marks the enterprise entries with a grey pill in a hairline border", () => {
      renderSettings();

      expect(
        screen.getByRole("link", { name: "Directory" }),
      ).toBeInTheDocument();
      const pills = screen.getAllByText("ENT");
      expect(pills.length).toBeGreaterThanOrEqual(1);
      // The hairline border is pinned on the shared chip style itself:
      // shell/__tests__/quietChipStyle.unit.test.ts.
      expect(pills[0]).toHaveStyle({
        color: "var(--chakra-colors-gray-400)",
      });
    });

    /** @scenario "The settings groups fold, and start open" */
    it("opens every group, folds one away, and keeps it folded next time", async () => {
      const user = userEvent.setup();
      const { unmount } = renderSettings();

      // A folded group reads "Expand <name>", so none of them means all open.
      expect(screen.queryAllByRole("button", { name: /^Expand / })).toEqual([]);
      expect(
        screen.getAllByRole("button", { name: /^Collapse / }).length,
      ).toBeGreaterThan(1);
      expect(screen.getByRole("link", { name: "Members" })).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Collapse People & access" }),
      );

      expect(
        screen.queryByRole("link", { name: "Members" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Collapse Organization" }),
      ).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("link", { name: "General" })).toBeInTheDocument();

      unmount();
      renderSettings();

      expect(
        screen.getByRole("button", { name: "Expand People & access" }),
      ).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.queryByRole("link", { name: "Members" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "General" })).toBeInTheDocument();
    });

    /** @scenario "A rule separates the way back from the pages below it" */
    it("draws a rule under the way back entry", () => {
      renderSettings();

      const backEntry = screen.getByRole("link", { name: /^Back/ });
      expect(backEntry.parentElement).toHaveStyle({
        borderBottomWidth: "1px",
      });
    });

    /** @scenario "The way back stays in place while the menu scrolls" */
    it("keeps the way back out of the region the menu scrolls in", () => {
      renderSettings();

      const scrollRegion = screen.getByTestId("sidebar-scroll-region");
      expect(scrollRegion).not.toContainElement(
        screen.getByRole("link", { name: /^Back/ }),
      );
      // The pages themselves are what scrolls, so they stay inside it.
      expect(scrollRegion).toContainElement(
        screen.getByRole("link", { name: "Members" }),
      );
    });

    /** @scenario "The pages are cut at the rule as they scroll under the way back" */
    it("starts the scrolling part at the rule and keeps the gap inside it", () => {
      renderSettings();

      const backEntry = screen.getByRole("link", { name: /^Back/ });
      // A margin under the rule is a strip the pages disappear in before they
      // reach the line. As padding inside the scrolling part, the same space
      // holds the first page off the rule and the pages travel through it.
      // An unset margin reads as "0" here, where a spacing step would read as
      // the variable the scale is written with.
      expect(getComputedStyle(backEntry.parentElement!).marginBottom).toBe("0");
      expect(
        getComputedStyle(screen.getByTestId("sidebar-scroll-region"))
          .paddingTop,
      ).toBe("var(--chakra-spacing-1\\.5)");
    });

    /** @scenario "API Keys sits under General" */
    it("puts API Keys under General, above the ACCESS group", () => {
      renderSettings();

      const entries = within(screen.getByTestId("sidebar-scroll-region"))
        .getAllByRole("link")
        .map((link) => link.textContent?.trim());

      // It moved out of ACCESS rather than gaining a second home there, which
      // an index lookup on its own would read as the move having worked.
      expect(entries.filter((entry) => entry === "API Keys")).toHaveLength(1);
      expect(entries.indexOf("API Keys")).toBe(entries.indexOf("General") + 1);
      // Members opens ACCESS, so an entry before it is in ORGANIZATION.
      expect(entries.indexOf("API Keys")).toBeLessThan(
        entries.indexOf("Members"),
      );
    });

    /** @scenario The menu marks the page that is open */
    it("marks the entry of the page on screen, and only that one", () => {
      mockPathname = "/settings/email-suppressions";
      renderSettings();

      const marked = within(screen.getByTestId("sidebar-scroll-region"))
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page")
        .map((link) => link.textContent?.trim());

      expect(marked).toEqual(["Email Suppressions"]);
    });

    it("hides the enterprise entries outside an enterprise plan", () => {
      mockIsEnterprise = false;
      renderSettings();

      expect(
        screen.queryByRole("link", { name: "Roles" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Directory" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("ENT")).not.toBeInTheDocument();
      // The reader's own pages are not the organization's, so no plan gates
      // them.
      expect(
        screen.getByRole("link", { name: "Security" }),
      ).toBeInTheDocument();
    });

    /** @scenario A lite member sees no restricted settings entries */
    it("hides the restricted entries from a lite member", () => {
      mockIsLiteMember = true;
      renderSettings();

      expect(
        screen.queryByRole("link", { name: "API Keys" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Secrets" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the settings top bar renders", () => {
    /** @scenario The top bar shows a static Settings title */
    it("shows a static Settings title, no product dropdown, and the organization", () => {
      renderSettings();

      expect(
        screen.queryByRole("button", { name: "Switch product" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
      expect(screen.getByText("ACME")).toBeInTheDocument();
    });
  });

  describe("when the device is in legacy mode", () => {
    /** @scenario Legacy mode keeps the current settings chrome */
    it("keeps the current settings navigation", () => {
      useNavigationModeStore.setState({ storedMode: "legacy" });
      renderSettings();

      expect(
        screen.getByRole("link", { name: "General Settings" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Quick Search" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the reader has ops access and is an admin", () => {
    /** @scenario The settings menu holds the ops groups at the bottom */
    it("puts OPS and BACKOFFICE last", () => {
      mockHasOpsAccess = true;
      mockIsAdmin = true;
      renderSettings();

      const groupLabels = screen
        .getAllByText(
          /^(Organization|People & access|AI Infrastructure|Data Controls|Project|Ops|Backoffice)$/,
        )
        .map((node) => node.textContent);

      expect(groupLabels.slice(-2)).toEqual(["Ops", "Backoffice"]);
    });
  });

  describe("when the pin flag and the environment variable are both off", () => {
    /** @scenario The settings menu shows ops without the pin flag or the environment variable */
    it("still shows the OPS group away from an ops page", () => {
      // `usePublicEnv` names no SHOW_OPS_IN_MAIN_SIDEBAR and the address
      // is a settings page, so the two conditions the legacy sidebar
      // needs are both absent here.
      mockHasOpsAccess = true;
      renderSettings();

      expect(screen.getByText("Ops")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "The Foundry" }),
      ).toBeInTheDocument();
    });
  });

  describe("when the reader has no ops access", () => {
    /** @scenario A reader without ops access sees no ops groups */
    it("shows neither the OPS group nor the BACKOFFICE group", () => {
      renderSettings();

      expect(screen.queryByText("Ops")).not.toBeInTheDocument();
      expect(screen.queryByText("Backoffice")).not.toBeInTheDocument();
    });
  });

  describe("when an ops page is opened in a new navigation mode", () => {
    /** @scenario An ops page renders inside the new settings shell */
    it("renders the settings shell with the matching entry marked active", () => {
      mockHasOpsAccess = true;
      renderOpsPage("/ops/migrations");

      // The settings surface, not the project sidebar: Quick Search and
      // the settings menu are there, the product dropdown is not.
      expect(
        screen.getByRole("button", { name: "Quick Search" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Switch product" }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("ops-page-content")).toBeInTheDocument();

      const migrations = screen.getByRole("link", { name: "Migrations" });
      expect(migrations).toHaveAttribute("aria-current", "page");
    });

    /** @scenario An ops page renders inside the new settings shell */
    it("marks the owning entry active on an address that redirects onto it", () => {
      mockHasOpsAccess = true;
      renderOpsPage("/ops/scheduler");

      expect(
        screen.getByRole("link", { name: "Event Sourcing" }),
      ).toHaveAttribute("aria-current", "page");
    });
  });
});
