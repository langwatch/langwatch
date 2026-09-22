/**
 * @vitest-environment jsdom
 *
 * The navigation-v2 chrome on a phone-width viewport: the compact bar
 * with the scope and the menu button, and the full-screen menu overlay,
 * mounted through the real DashboardLayout dispatcher with the device
 * on the product-switcher mode and the viewport mocked to phone width.
 *
 * Spec: specs/navigation/mobile-chrome.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/[project]";
let mockGovernanceFlagEnabled = true;
const pushMock = vi.fn().mockResolvedValue(true);

const teamA = {
  id: "team_1",
  name: "Core",
  slug: "core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1", role: "ADMIN" }],
  projects: [
    { id: "project_1", slug: "demo", name: "Demo", isPersonal: false },
    {
      id: "project_2",
      slug: "support-bot",
      name: "Support Bot",
      isPersonal: false,
    },
  ],
};
/** The reader's own workspace, which is what the Me pages resolve. */
const personalTeam = {
  id: "team_personal",
  name: "Ada's Workspace",
  slug: "personal-ada",
  isPersonal: true,
  ownerUserId: "user_1",
  members: [{ userId: "user_1", role: "ADMIN" }],
  projects: [
    {
      id: "project_personal",
      slug: "personal-ada-abc123",
      name: "Personal Workspace",
      isPersonal: true,
    },
  ],
};
const orgA = {
  id: "org_1",
  name: "ACME",
  members: [{ userId: "user_1", role: "ADMIN" }],
  teams: [teamA, personalTeam],
};
/** The team the page being rendered resolves to. */
let mockAmbientTeam: {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  members: Array<{ userId: string; role: string }>;
  projects: Array<{
    id: string;
    slug: string;
    name: string;
    isPersonal: boolean;
  }>;
} = teamA;
const orgB = {
  id: "org_2",
  name: "Beta Corp",
  members: [{ userId: "user_1", role: "ADMIN" }],
  teams: [
    {
      id: "team_2",
      name: "Beta",
      slug: "beta",
      isPersonal: false,
      ownerUserId: null,
      members: [{ userId: "user_1", role: "ADMIN" }],
      projects: [
        {
          id: "project_3",
          slug: "beta-app",
          name: "Beta App",
          isPersonal: false,
        },
      ],
    },
  ],
};
let mockOrganizations: unknown[] = [orgA];

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: mockPathname,
    query: {},
    asPath: mockPathname,
    push: pushMock,
    replace: vi.fn(),
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }),
}));

vi.mock("~/utils/compat/next-head", () => ({
  default: () => null,
}));

let mockIsMobile = true;
vi.mock("~/features/navigation/shell/useIsMobileViewport", () => ({
  useIsMobileViewport: () => mockIsMobile,
}));

let mockNavPathname = "/demo";
vi.mock("~/utils/compat/next-navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePathname: () => mockNavPathname,
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
    organization: mockOrganizations[0],
    organizations: mockOrganizations,
    team: mockAmbientTeam,
    project: mockAmbientTeam.projects[0],
    organizationRole: "ADMIN",
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: () => ({ isLiteMember: false }),
}));

vi.mock("~/hooks/useFeatureFlag", async () => {
  const actual = await vi.importActual<object>("~/hooks/useFeatureFlag");
  return {
    ...actual,
    useFeatureFlag: (flag: string) => ({
      enabled:
        flag === "release_ui_ai_governance_enabled"
          ? mockGovernanceFlagEnabled
          : true,
      isLoading: false,
    }),
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
  useOpsPermission: () => ({ hasAccess: false }),
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
      isAdmin: { useQuery: () => ({ data: { isAdmin: false } }) },
      // The dashboard shell mounts the secure-account nudge and the
      // organization's second-factor gate on every page, so a mock that
      // names neither takes the whole shell down.
      secureAccountNudge: { useQuery: () => ({ data: undefined }) },
      dismissSecureAccountNudge: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    twoStepVerification: {
      standing: { useQuery: () => ({ data: undefined }) },
    },
    // The shell also mounts the join-your-team notice.
    joinRequests: {
      offer: { useQuery: () => ({ data: undefined }) },
      mine: { useQuery: () => ({ data: undefined }) },
      request: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      dismissOffer: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    useUtils: () => ({
      user: { secureAccountNudge: { invalidate: vi.fn() } },
      joinRequests: {
        mine: { invalidate: vi.fn() },
        offer: { invalidate: vi.fn() },
      },
    }),
    auth: {
      myAddressConfirmation: { useQuery: () => ({ data: undefined }) },
      sendMyAddressConfirmation: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
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
        useQuery: (input: { flag: string }) => ({
          data: {
            enabledByOrganizationId: {
              org_1: true,
              org_2:
                input.flag === "release_ui_ai_governance_enabled"
                  ? mockGovernanceFlagEnabled
                  : true,
            },
          },
        }),
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
vi.mock("../../../../ee/admin/ImpersonationBanner", () => ({
  ImpersonationBanner: () => null,
}));
vi.mock("../../../../ee/admin/ImpersonationSwitchBackMenuItem", () => ({
  ImpersonationSwitchBackMenuItem: () => null,
}));
vi.mock("~/components/sidebar/PresenceMenuItem", () => ({
  PresenceMenuItem: () => null,
}));

import { useNavigationModeStore } from "~/features/navigation/navigationModeStore";
import {
  DashboardLayout,
  type DashboardLayoutProps,
} from "../../../components/DashboardLayout";

function renderShell(props: Partial<DashboardLayoutProps> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DashboardLayout {...props}>
        <div data-testid="page-body" />
      </DashboardLayout>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mockIsMobile = true;
  mockNavPathname = "/demo";
  mockPathname = "/[project]";
  mockGovernanceFlagEnabled = true;
  mockOrganizations = [orgA];
  mockAmbientTeam = teamA;
  pushMock.mockClear();
  trackEventMock.mockReset();
  commandBarOpenMock.mockReset();
  localStorage.clear();
  localStorage.setItem("langwatch:navigation-mode:v1", "product-switcher");
  useNavigationModeStore.setState({ storedMode: "product-switcher" });
});

afterEach(() => {
  cleanup();
});

describe("the mobile chrome", () => {
  describe("when an LLM Ops page renders at phone width", () => {
    /** @scenario The mobile top bar holds the scope and the menu button only */
    it("shows the logo, the product selector, the project selector and the menu button, with no sidebar", () => {
      renderShell();

      expect(
        screen.getByRole("button", { name: "Switch product" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Switch project" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Open navigation menu" }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("product-sidebar")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("shell-product-cluster"),
      ).not.toBeInTheDocument();
    });

    /** @scenario LLM Ops keeps the organization out of the mobile bar */
    it("keeps the organization control out of the bar and offers it in the overlay", async () => {
      mockOrganizations = [orgA, orgB];
      renderShell();

      expect(
        screen.queryByRole("button", { name: "Switch organization" }),
      ).not.toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(
        screen.getByRole("button", { name: "Open navigation menu" }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });
      expect(
        screen.getByRole("button", { name: "Switch organization" }),
      ).toBeInTheDocument();
    });

    /** @scenario The menu button opens the navigation overlay */
    it("opens a full-screen overlay carrying the product's pages and the account controls", async () => {
      const user = userEvent.setup();
      renderShell();

      await user.click(
        screen.getByRole("button", { name: "Open navigation menu" }),
      );

      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });
      const overlay = within(screen.getByTestId("mobile-menu-overlay"));
      expect(overlay.getByLabelText("Quick Search")).toBeInTheDocument();
      expect(overlay.getByText("Trace Explorer")).toBeInTheDocument();
      expect(
        overlay.getByRole("button", { name: "Open user menu for Ada" }),
      ).toBeInTheDocument();
      expect(
        overlay.getByRole("button", { name: "Close navigation menu" }),
      ).toBeInTheDocument();
    });

    /** @scenario Navigating from the overlay closes it */
    it("closes the overlay when a page is opened from it", async () => {
      const user = userEvent.setup();
      const view = renderShell();

      await user.click(
        screen.getByRole("button", { name: "Open navigation menu" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });

      // Tap a real entry. jsdom cannot follow the anchor, so the route
      // change the tap causes is applied to the mocked pathname by hand.
      const overlay = within(screen.getByTestId("mobile-menu-overlay"));
      const entry = overlay.getByRole("link", { name: /Analytics/ });
      expect(entry).toHaveAttribute("href", "/demo/analytics");
      entry.addEventListener("click", (event) => event.preventDefault());
      await user.click(entry);

      mockNavPathname = "/demo/analytics";
      view.rerender(
        <ChakraProvider value={defaultSystem}>
          <DashboardLayout>
            <div data-testid="page-body" />
          </DashboardLayout>
        </ChakraProvider>,
      );

      await waitFor(() => {
        expect(
          screen.queryByTestId("mobile-menu-overlay"),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("page-body")).toBeInTheDocument();
    });

    /** @scenario The close button dismisses the overlay without navigating */
    it("closes when the close button is tapped and stays on the page", async () => {
      const user = userEvent.setup();
      renderShell();

      await user.click(
        screen.getByRole("button", { name: "Open navigation menu" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });
      expect(
        screen.getByRole("dialog", { name: "Navigation menu" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Close navigation menu" }),
      ).toHaveFocus();

      await user.click(
        screen.getByRole("button", { name: "Close navigation menu" }),
      );

      await waitFor(() => {
        expect(
          screen.queryByTestId("mobile-menu-overlay"),
        ).not.toBeInTheDocument();
      });
      expect(pushMock).not.toHaveBeenCalled();
      expect(screen.getByTestId("page-body")).toBeInTheDocument();
    });

    /** @scenario The overlay keeps the keyboard inside it */
    it("marks the page behind it inert and wraps Tab inside itself", async () => {
      const user = userEvent.setup();
      renderShell();

      await user.click(
        screen.getByRole("button", { name: "Open navigation menu" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });

      // Everything the shell renders under the overlay is inert, so the
      // page behind carries no tab stop and no reader can reach it.
      const overlay = screen.getByTestId("mobile-menu-overlay");
      expect(
        screen.getByTestId("page-body").closest("[inert]"),
      ).toBeInTheDocument();
      expect(overlay.closest("[inert]")).toBeNull();

      const focusable = Array.from(
        overlay.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const last = focusable.at(-1);
      const first = focusable[0];
      expect(last).toBeDefined();
      last?.focus();

      await user.tab();
      expect(first).toHaveFocus();

      await user.tab({ shift: true });
      expect(last).toHaveFocus();
    });

    /** @scenario Escape closes only the menu on top */
    it("leaves Escape to the menu the overlay opened", async () => {
      mockOrganizations = [orgA, orgB];
      const user = userEvent.setup();
      renderShell();

      await user.click(
        screen.getByRole("button", { name: "Open navigation menu" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole("button", { name: "Switch organization" }),
      );
      await waitFor(() => {
        expect(screen.getByText("Beta Corp")).toBeInTheDocument();
      });

      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(screen.queryByText("Beta Corp")).not.toBeInTheDocument();
      });
      expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
    });

    /** @scenario Escape closes the overlay and returns focus to the menu button */
    it("closes on Escape and moves focus back to the menu button", async () => {
      const user = userEvent.setup();
      renderShell();

      const menuButton = screen.getByRole("button", {
        name: "Open navigation menu",
      });
      await user.click(menuButton);
      await waitFor(() => {
        expect(screen.getByTestId("mobile-menu-overlay")).toBeInTheDocument();
      });

      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(
          screen.queryByTestId("mobile-menu-overlay"),
        ).not.toBeInTheDocument();
      });
      expect(menuButton).toHaveFocus();
    });
  });

  describe("when a Gateway page renders at phone width", () => {
    /** @scenario An organization product shows the organization in the mobile bar */
    it("shows the organization and no project selector", () => {
      mockPathname = "/gateway/virtual-keys";
      renderShell();

      // A single organization reads as plain text, same as on desktop.
      expect(screen.getByText("ACME")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Switch project" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the viewport is desktop-width", () => {
    /** @scenario Tablet and desktop widths keep the sidebar chrome */
    it("keeps the sidebar and offers no menu button", () => {
      mockIsMobile = false;
      renderShell();

      expect(screen.getByTestId("product-sidebar")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Open navigation menu" }),
      ).not.toBeInTheDocument();
    });
  });
});
