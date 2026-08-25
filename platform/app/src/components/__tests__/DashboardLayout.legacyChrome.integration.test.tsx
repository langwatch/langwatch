/**
 * @vitest-environment jsdom
 *
 * Pins the legacy dashboard chrome BEFORE the navigation-v2 dispatcher
 * splits DashboardLayout: which sidebar renders per route class, the
 * single workspace switcher in the header, and the avatar menu's exact
 * item list with no Navigation entry while the navigation flag is off.
 * Flag-off customers must keep this chrome unchanged through the split.
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/[project]";
let mockNavigationV2FlagEnabled = false;
let mockNavigationV2FlagLoading = false;

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: mockPathname,
    query: { project: "demo" },
    asPath: mockPathname,
    push: vi.fn(),
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
// organization admin the fixture signs in as passes them on their role.
vi.mock("~/hooks/useOrganizationTeamProject", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org_1", name: "ACME", members: [] },
    organizations: [{ id: "org_1", name: "ACME", teams: [] }],
    team: {
      id: "team_1",
      name: "Core",
      isPersonal: false,
      ownerUserId: null,
      members: [],
    },
    project: { id: "project_1", slug: "demo", name: "Demo" },
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
        flag === "release_ui_navigation_v2_enabled" ? mockNavigationV2FlagEnabled : true,
      isLoading:
        flag === "release_ui_navigation_v2_enabled" ? mockNavigationV2FlagLoading : false,
    }),
  };
});

const trackEventMock = vi.fn();
vi.mock("~/utils/tracking", () => ({
  trackEvent: (...args: unknown[]) => trackEventMock(...args),
}));

vi.mock("../LoadingScreen", () => ({
  LoadingScreen: () => <div data-testid="loading-screen" />,
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({
    data: {
      NODE_ENV: "test",
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

vi.mock("~/features/langy/stores/langyStore", () => ({
  useLangyStore: (selector: (state: unknown) => unknown) =>
    selector({
      dockShifted: false,
      claimDockShell: () => undefined,
      releaseDockShell: () => undefined,
    }),
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
    ops: {
      getScope: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    governance: {
      recordWorkspaceView: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    featureFlag: {
      isEnabledForEachOrganization: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

vi.mock("../MainMenu", () => ({
  MainMenu: () => <nav data-testid="main-menu" />,
  MainMenuSections: () => null,
  MENU_WIDTH_COMPACT: "49px",
  MENU_WIDTH_EXPANDED: "190px",
}));

vi.mock("../PersonalSidebar", () => ({
  PersonalSidebar: () => <nav data-testid="personal-sidebar" />,
  PersonalSidebarLinks: () => null,
}));

vi.mock("../WorkspaceSwitcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("../useWorkspaceData", () => ({
  useWorkspaceData: () => ({
    personals: [],
    teams: [],
    projects: [],
    onCreateProjectForTeam: vi.fn(),
  }),
}));

vi.mock("~/utils/crispBubblePolicy", () => ({
  toggleSupportChat: vi.fn(),
}));

vi.mock("../../features/command-bar", () => ({
  CommandBarTrigger: () => null,
  useCommandBar: () => ({ open: vi.fn() }),
}));

vi.mock("../../features/traces-v2/components/GlobalTraceV2DrawerMount", () => ({
  GlobalTraceV2DrawerMount: () => null,
}));

vi.mock("../CurrentDrawer", () => ({ CurrentDrawer: () => null }));
vi.mock("../AnnouncementBanner", () => ({ AnnouncementBanner: () => null }));
vi.mock("../UpgradeModal", () => ({ GlobalUpgradeModal: () => null }));
vi.mock("../SavedViewsBar", () => ({ SavedViewsBar: () => null }));
vi.mock("../governance/AdminViewingAsBanner", () => ({
  AdminViewingAsBanner: () => null,
}));
vi.mock("@langwatch/ops-web", () => ({
  ImpersonationBanner: () => null,
}));
vi.mock("~/components/ops/ImpersonationSwitchBackMenuItem", () => ({
  ImpersonationSwitchBackMenuItem: () => null,
}));
vi.mock("../sidebar/PresenceMenuItem", () => ({
  PresenceMenuItem: () => null,
}));

import { useNavigationModeStore } from "~/features/navigation/navigationModeStore";
import { DashboardLayout } from "../DashboardLayout";

function renderLayout(props: Record<string, unknown> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DashboardLayout {...props}>
        <div data-testid="page-body" />
      </DashboardLayout>
    </ChakraProvider>,
  );
}

async function openAvatarMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /open user menu/i }));
  await waitFor(() => {
    expect(screen.getByText("Logout")).toBeInTheDocument();
  });
  return user;
}

beforeEach(() => {
  mockPathname = "/[project]";
  mockNavigationV2FlagEnabled = false;
  mockNavigationV2FlagLoading = false;
  trackEventMock.mockReset();
  localStorage.clear();
  useNavigationModeStore.setState({ storedMode: "legacy" });
});

afterEach(() => {
  cleanup();
});

describe("legacy dashboard chrome", () => {
  describe("when on a project route", () => {
    /** @scenario Flag off keeps the current chrome unchanged */
    it("renders the main menu, one workspace switcher and the page body", () => {
      renderLayout();

      expect(screen.getByTestId("main-menu")).toBeInTheDocument();
      expect(screen.queryByTestId("personal-sidebar")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("workspace-switcher")).toHaveLength(1);
      expect(screen.getByTestId("page-body")).toBeInTheDocument();
    });
  });

  describe("when on a personal-scope route", () => {
    /** @scenario Legacy mode keeps the personal sidebar on a personal page */
    it("renders the personal sidebar instead of the main menu", () => {
      mockPathname = "/me";
      renderLayout({ personalScope: true });

      expect(screen.getByTestId("personal-sidebar")).toBeInTheDocument();
      expect(screen.queryByTestId("main-menu")).not.toBeInTheDocument();
    });
  });

  describe("when the avatar menu opens with the navigation flag off", () => {
    /** @scenario Flag off keeps the current chrome unchanged */
    it("shows exactly the current items and no Navigation entry", async () => {
      renderLayout();
      await openAvatarMenu();

      expect(screen.getByText("My Workspace")).toBeInTheDocument();
      expect(screen.getByText("API Keys")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
      expect(screen.getByText(/Reduced graphics/)).toBeInTheDocument();
      expect(screen.getByText("Logout")).toBeInTheDocument();
      expect(screen.queryByText(/^Navigation \(/)).not.toBeInTheDocument();
    });
  });
});

describe("navigation mode dispatcher", () => {
  describe("when the device stored a v2 mode and the flag has not answered", () => {
    /** @scenario A device set to a new mode waits for the flag instead of flashing the old chrome */
    it("shows the loading screen instead of any chrome", () => {
      useNavigationModeStore.setState({ storedMode: "icon-rail" });
      mockNavigationV2FlagLoading = true;
      renderLayout();

      expect(screen.getByTestId("loading-screen")).toBeInTheDocument();
      expect(screen.queryByTestId("main-menu")).not.toBeInTheDocument();
      expect(screen.queryByTestId("page-body")).not.toBeInTheDocument();
    });
  });

  describe("when the device stored a v2 mode and the flag is off", () => {
    /** @scenario The flag off falls back to legacy and keeps the preference */
    it("renders the legacy chrome", () => {
      useNavigationModeStore.setState({ storedMode: "icon-rail" });
      mockNavigationV2FlagEnabled = false;
      renderLayout();

      expect(screen.getByTestId("main-menu")).toBeInTheDocument();
      expect(screen.getByTestId("page-body")).toBeInTheDocument();
    });
  });

  describe("given the flag is on and the address is an internal ops page", () => {
    beforeEach(() => {
      mockNavigationV2FlagEnabled = true;
      mockPathname = "/ops/feature-flags";
    });

    describe("when the layout renders", () => {
      /** @scenario Internal ops pages render in the new settings shell */
      it("renders the new shell rather than the legacy main menu", () => {
        useNavigationModeStore.setState({ storedMode: "icon-rail" });
        renderLayout();

        expect(screen.queryByTestId("main-menu")).not.toBeInTheDocument();
        expect(screen.getByTestId("page-body")).toBeInTheDocument();
        expect(screen.queryByTestId("loading-screen")).not.toBeInTheDocument();
      });

      /** @scenario Internal ops pages render in the new settings shell */
      it("does not treat the ops page as a product page", () => {
        useNavigationModeStore.setState({ storedMode: "product-switcher" });
        renderLayout();

        expect(
          screen.queryByRole("button", { name: "Switch product" }),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given the flag is on and the address is outside the new shells", () => {
    describe("when the layout renders", () => {
      /** @scenario A page outside the new shells keeps the old navigation */
      it("renders the legacy chrome on an auth page", () => {
        useNavigationModeStore.setState({ storedMode: "icon-rail" });
        mockNavigationV2FlagEnabled = true;
        mockPathname = "/auth/signin";
        renderLayout();

        expect(screen.getByTestId("main-menu")).toBeInTheDocument();
        expect(screen.getByTestId("page-body")).toBeInTheDocument();
        expect(screen.queryByTestId("loading-screen")).not.toBeInTheDocument();
      });
    });
  });
});

describe("avatar menu navigation submenu", () => {
  describe("when the navigation flag is on", () => {
    /** @scenario The avatar menu offers the three navigation modes */
    it("shows the Navigation entry with the current mode", async () => {
      mockNavigationV2FlagEnabled = true;
      renderLayout();
      await openAvatarMenu();

      expect(screen.getByText("Navigation (Old navigation)")).toBeInTheDocument();
    });

    /** @scenario Picking a mode persists on the device */
    it("persists a picked mode and reports the change", async () => {
      mockNavigationV2FlagEnabled = true;
      renderLayout();
      const user = await openAvatarMenu();

      await user.click(screen.getByText("Navigation (Old navigation)"));
      await waitFor(() => {
        expect(
          screen.getByRole("menuitemradio", { name: "Icon rail" }),
        ).toBeInTheDocument();
      });
      await user.click(screen.getByRole("menuitemradio", { name: "Icon rail" }));

      await waitFor(() => {
        expect(useNavigationModeStore.getState().storedMode).toBe("icon-rail");
      });
      expect(localStorage.getItem("langwatch:navigation-mode:v1")).toBe("icon-rail");
      expect(trackEventMock).toHaveBeenCalledWith("navigation_mode_change", {
        mode: "icon-rail",
      });
    });
  });
});
