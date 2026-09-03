/**
 * @vitest-environment jsdom
 *
 * The icon-rail shell: the full-height product rail with one tile per
 * reachable product and a bottom Settings tile, and the top bar without
 * the product dropdown, mounted through the real DashboardLayout
 * dispatcher with the device on the icon-rail mode.
 *
 * Spec: specs/navigation/icon-rail-navigation.feature
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
const orgA = {
  id: "org_1",
  name: "ACME",
  members: [{ userId: "user_1", role: "ADMIN" }],
  teams: [teamA],
};
const _orgB = {
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
    team: teamA,
    project: teamA.projects[0],
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
import { DashboardLayout } from "../../../components/DashboardLayout";
import { ICON_RAIL_WIDTH } from "../shell/IconRail";
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../shell/shellLayout";

function renderShell(props: Record<string, unknown> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DashboardLayout {...props}>
        <div data-testid="page-body" />
      </DashboardLayout>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  mockPathname = "/[project]";
  mockGovernanceFlagEnabled = true;
  mockOrganizations = [orgA];
  pushMock.mockClear();
  trackEventMock.mockReset();
  commandBarOpenMock.mockReset();
  localStorage.clear();
  localStorage.setItem("langwatch:navigation-mode:v1", "icon-rail");
  useNavigationModeStore.setState({ storedMode: "icon-rail" });
});

afterEach(() => {
  cleanup();
});

const railTile = (name: string) =>
  within(screen.getByRole("navigation", { name: "Products" })).queryByRole(
    "button",
    { name },
  );

describe("the icon-rail shell", () => {
  describe("when the rail renders", () => {
    /** @scenario The rail is its own surface next to the sidebar */
    it("closes the rail with an edge against the sidebar", () => {
      renderShell();

      expect(screen.getByRole("navigation", { name: "Products" })).toHaveStyle({
        width: ICON_RAIL_WIDTH,
        borderRightWidth: "1px",
        borderRightColor: "var(--chakra-colors-border)",
      });
    });

    /** @scenario Only the active tile carries a surface */
    it("raises the active tile and leaves the other tiles flat", () => {
      renderShell();

      expect(railTile("LLM Ops")).toHaveStyle({
        backgroundColor: "var(--chakra-colors-bg-panel)",
      });
      expect(railTile("Gateway")).not.toHaveStyle({
        backgroundColor: "var(--chakra-colors-bg-panel)",
      });
    });
  });

  describe("when a page renders beside the rail", () => {
    /** @scenario The page keeps its right edge inside the window */
    it("gives the page the window less the rail and the sidebar", () => {
      renderShell();

      // Both are subtracted. Handing the rail over inside a `+` sum makes it
      // `calc(100vw - sidebar + rail)`, which reads left to right and gives
      // the page two rails it does not have.
      const roomForThePage =
        window.innerWidth -
        Number.parseInt(SHELL_SIDEBAR_WIDTH_EXPANDED, 10) -
        Number.parseInt(ICON_RAIL_WIDTH, 10);

      expect(screen.getByTestId("shell-content-column")).toHaveStyle({
        maxWidth: `${roomForThePage}px`,
      });
    });
  });

  describe("when every product is reachable", () => {
    /** @scenario The rail lists the reachable products as tiles */
    it("shows one tile per product and marks the active one", () => {
      renderShell();

      expect(railTile("Me")).toBeInTheDocument();
      expect(railTile("LLM Ops")).toBeInTheDocument();
      expect(railTile("Gateway")).toBeInTheDocument();
      expect(railTile("Governance")).toBeInTheDocument();
      expect(railTile("LLM Ops")).toHaveAttribute("aria-current", "page");
      expect(railTile("Gateway")).not.toHaveAttribute("aria-current");
    });
  });

  describe("when a product gate fails", () => {
    /** @scenario A product I cannot reach has no tile */
    it("shows no tile for it", () => {
      mockGovernanceFlagEnabled = false;
      renderShell();

      expect(railTile("Governance")).not.toBeInTheDocument();
    });
  });

  describe("when picking another product's tile", () => {
    /** @scenario Picking a rail tile opens that product's home */
    it("opens that product's home", async () => {
      renderShell();

      const user = userEvent.setup();
      await user.click(railTile("Gateway")!);

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith("/gateway/virtual-keys");
      });
      expect(trackEventMock).toHaveBeenCalledWith("navigation_product_switch", {
        product: "gateway",
      });
    });
  });

  describe("when picking the Settings tile", () => {
    /** @scenario The Settings tile sits at the bottom of the rail */
    it("opens the settings pages", async () => {
      renderShell();

      const user = userEvent.setup();
      await user.click(railTile("Settings")!);

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith("/settings");
      });
    });
  });

  describe("when the icon-rail top bar renders", () => {
    /** @scenario The top bar drops the product dropdown in the icon-rail mode */
    it("has no product dropdown but keeps the organization and the scope", () => {
      renderShell();

      expect(
        screen.queryByRole("button", { name: "Switch product" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("ACME")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Switch project" }),
      ).toBeInTheDocument();
    });
  });
});
