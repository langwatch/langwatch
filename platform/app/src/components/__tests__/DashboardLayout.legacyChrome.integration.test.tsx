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

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  userBelongsToTeam: () => true,
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

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled:
      flag === "release_ui_navigation_v2_enabled"
        ? mockNavigationV2FlagEnabled
        : true,
    isLoading: false,
  }),
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
    },
    governance: {
      recordWorkspaceView: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("../MainMenu", () => ({
  MainMenu: () => <nav data-testid="main-menu" />,
  MENU_WIDTH_COMPACT: "49px",
  MENU_WIDTH_EXPANDED: "190px",
}));

vi.mock("../PersonalSidebar", () => ({
  PersonalSidebar: () => <nav data-testid="personal-sidebar" />,
}));

vi.mock("../WorkspaceSwitcher", () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

vi.mock("../useWorkspaceData", () => ({
  useWorkspaceData: () => ({ organizations: [], currentOrganization: null }),
}));

vi.mock("../../features/command-bar", () => ({
  CommandBarTrigger: () => null,
}));

vi.mock("../../features/traces-v2/components/GlobalTraceV2DrawerMount", () => ({
  GlobalTraceV2DrawerMount: () => null,
}));

vi.mock("../CurrentDrawer", () => ({ CurrentDrawer: () => null }));
vi.mock("../AnnouncementBanner", () => ({ AnnouncementBanner: () => null }));
vi.mock("../UpgradeModal", () => ({ GlobalUpgradeModal: () => null }));
vi.mock("../messages/SavedViewsBar", () => ({ SavedViewsBar: () => null }));
vi.mock("../governance/AdminViewingAsBanner", () => ({
  AdminViewingAsBanner: () => null,
}));
vi.mock("../../../ee/admin/ImpersonationBanner", () => ({
  ImpersonationBanner: () => null,
}));
vi.mock("../../../ee/admin/ImpersonationSwitchBackMenuItem", () => ({
  ImpersonationSwitchBackMenuItem: () => null,
}));
vi.mock("../sidebar/PresenceMenuItem", () => ({
  PresenceMenuItem: () => null,
}));

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
      expect(screen.queryByText("Navigation")).not.toBeInTheDocument();
    });
  });
});
