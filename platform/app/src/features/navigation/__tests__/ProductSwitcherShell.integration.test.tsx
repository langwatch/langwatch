/**
 * @vitest-environment jsdom
 *
 * The product-switcher shell's top bar: the product dropdown built from
 * the registry and the reachable set, the organization control, and the
 * product-native scope, mounted through the real DashboardLayout
 * dispatcher with the device on the product-switcher mode.
 *
 * Spec: specs/navigation/product-switcher-navigation.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

/** Two teams and eleven projects: past the search threshold. */
const crowdedTeamCore = {
  id: "team_core",
  name: "Core",
  slug: "crowded-core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1", role: "ADMIN" }],
  projects: Array.from({ length: 9 }, (_, index) => ({
    id: `project_core_${index}`,
    slug: `core-app-${index}`,
    name: `Core App ${index}`,
    isPersonal: false,
  })),
};
const crowdedTeamPlatform = {
  id: "team_platform",
  name: "Platform",
  slug: "crowded-platform",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1", role: "ADMIN" }],
  projects: [
    {
      id: "project_router",
      slug: "edge-router",
      name: "Edge Router",
      isPersonal: false,
    },
    {
      id: "project_billing",
      slug: "billing-sync",
      name: "Billing Sync",
      isPersonal: false,
    },
  ],
};
const crowdedOrg = {
  id: "org_1",
  name: "ACME",
  members: [{ userId: "user_1", role: "ADMIN" }],
  teams: [crowdedTeamCore, crowdedTeamPlatform, personalTeam],
};

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
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../shell/shellLayout";

function renderShell(props: Partial<DashboardLayoutProps> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DashboardLayout {...props}>
        <div data-testid="page-body" />
      </DashboardLayout>
    </ChakraProvider>,
  );
}

/** The switcher row for a product, which is what carries its state. */
function productMenuItem(label: string) {
  return screen.getByText(label).closest("[role='menuitem']");
}

async function openProductSwitcher() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Switch product" }));
  await waitFor(() => {
    expect(
      screen.getByText("Observe, evaluate and test your agents"),
    ).toBeInTheDocument();
  });
  return user;
}

beforeEach(() => {
  mockPathname = "/[project]";
  mockGovernanceFlagEnabled = true;
  mockOrganizations = [orgA];
  mockAmbientTeam = teamA;
  pushMock.mockClear();
  trackEventMock.mockReset();
  commandBarOpenMock.mockReset();
  localStorage.clear();
  useNavigationModeStore.setState({ storedMode: "product-switcher" });
});

afterEach(() => {
  cleanup();
});

describe("the product-switcher top bar", () => {
  describe("when the product switcher opens", () => {
    /** @scenario The product switcher lists the reachable products with their pitch lines */
    it("lists the reachable products with their pitch lines and marks the active one", async () => {
      renderShell();
      await openProductSwitcher();

      expect(
        screen.getByText("Observe, evaluate and test your agents"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Route, meter and bill LLM usage"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Every AI tool, license, agent and dollar"),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Current product")).toBeInTheDocument();
    });

    /** @scenario A product I cannot reach is not offered */
    it("hides a product behind a gate that fails", async () => {
      mockGovernanceFlagEnabled = false;
      renderShell();
      await openProductSwitcher();

      expect(screen.queryByText("Governance")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Every AI tool, license, agent and dollar"),
      ).not.toBeInTheDocument();
    });

    /** @scenario Switching product opens that product's home */
    it("opens the picked product's home", async () => {
      renderShell();
      const user = await openProductSwitcher();

      await user.click(screen.getByText("Gateway"));

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith("/gateway/virtual-keys");
      });
      expect(trackEventMock).toHaveBeenCalledWith("navigation_product_switch", {
        product: "gateway",
      });
    });
  });

  describe("when the top bar renders the product cluster", () => {
    /** @scenario The product selector reads as a raised pill */
    it("gives the product trigger its own surface, a border and a radius", () => {
      renderShell();

      expect(
        screen.getByRole("button", { name: "Switch product" }),
      ).toHaveStyle({
        backgroundColor: "var(--chakra-colors-bg-panel)",
        borderWidth: "1px",
        borderRadius: "var(--chakra-radii-lg)",
      });
    });

    /** @scenario The organization and the scope start at the content column */
    it("takes the width of the sidebar column, the same width the content cap uses", () => {
      renderShell();

      expect(screen.getByTestId("shell-product-cluster")).toHaveStyle({
        width: SHELL_SIDEBAR_WIDTH_EXPANDED,
        minWidth: SHELL_SIDEBAR_WIDTH_EXPANDED,
      });
      // The content column caps itself at the viewport minus that same
      // width, so the two cannot drift apart.
      expect(screen.getByTestId("shell-content-column")).toHaveStyle({
        maxWidth: `${window.innerWidth - Number.parseInt(SHELL_SIDEBAR_WIDTH_EXPANDED, 10)}px`,
      });
    });
  });

  describe("when the user belongs to one organization", () => {
    /** @scenario A single organization shows as plain text */
    it("shows the organization name as plain text with no menu", () => {
      renderShell();

      expect(screen.getByText("ACME")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Switch organization" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the user belongs to two organizations", () => {
    /** @scenario A multi-organization user switches organization in place */
    it("stores the selection, clears the project memory and opens the same product there", async () => {
      mockOrganizations = [orgA, orgB];
      mockPathname = "/gateway/virtual-keys";
      localStorage.setItem("selectedProjectSlug", JSON.stringify("demo"));
      renderShell();

      const user = userEvent.setup();
      await user.click(
        screen.getByRole("button", { name: "Switch organization" }),
      );
      await waitFor(() => {
        expect(screen.getByText("Beta Corp")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Beta Corp"));

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith("/gateway/virtual-keys");
      });
      expect(localStorage.getItem("selectedOrganizationId")).toBe(
        JSON.stringify("org_2"),
      );
      expect(localStorage.getItem("selectedProjectSlug")).toBeNull();
    });
  });

  describe("when on an LLM Ops page", () => {
    /** @scenario The LLM Ops scope shows the project switch chip */
    it("shows the current project as a chip that opens the project menu", async () => {
      renderShell();

      const chip = screen.getByRole("button", { name: "Switch project" });
      expect(chip).toHaveTextContent("Demo");

      const user = userEvent.setup();
      await user.click(chip);
      await waitFor(() => {
        expect(screen.getByText("Support Bot")).toBeInTheDocument();
      });
    });
  });

  describe("when the organization holds more than eight projects", () => {
    beforeEach(() => {
      mockOrganizations = [crowdedOrg];
      mockAmbientTeam = crowdedTeamCore;
    });

    async function openProjectPicker() {
      // Ark's combobox input is machine-controlled, so zero-delay typing
      // outruns the re-render and drops characters; a small delay types
      // the way a person does.
      const user = userEvent.setup({ delay: 20 });
      await user.click(screen.getByRole("button", { name: "Switch project" }));
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Search projects"),
        ).toBeInTheDocument();
      });
      return user;
    }

    /** @scenario A large project list opens with a focused search field */
    it("opens with a focused search field that filters by project and team name", async () => {
      renderShell();
      const user = await openProjectPicker();

      expect(screen.getByPlaceholderText("Search projects")).toHaveFocus();
      await waitFor(() => {
        expect(screen.getByText("Edge Router")).toBeInTheDocument();
      });

      await user.keyboard("router");
      await waitFor(() => {
        expect(screen.queryByText("Core App 1")).not.toBeInTheDocument();
      });
      expect(screen.getByText("Edge Router")).toBeInTheDocument();

      // Team names match too: "platform" is the team, not a project name.
      await user.clear(screen.getByPlaceholderText("Search projects"));
      await user.keyboard("platform");
      await waitFor(() => {
        expect(screen.getByText("Billing Sync")).toBeInTheDocument();
      });
      expect(screen.getByText("Edge Router")).toBeInTheDocument();
      expect(screen.queryByText("Core App 1")).not.toBeInTheDocument();
    });

    /** @scenario The project search answers the keyboard */
    it("moves with the arrow keys and opens the highlighted project on Enter", async () => {
      renderShell();
      const user = await openProjectPicker();

      await user.keyboard("billing");
      await waitFor(() => {
        expect(screen.getByText("Billing Sync")).toBeInTheDocument();
      });
      await user.keyboard("{ArrowDown}{Enter}");

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith(
          expect.stringContaining("billing-sync"),
        );
      });
    });

    /** @scenario Creating a project stays available while the list is unfiltered */
    it("keeps the per-team create entries while nothing is typed and drops them while searching", async () => {
      renderShell();
      const user = await openProjectPicker();

      // One create entry per team the user can create in (org admin: both).
      expect(screen.getAllByText("New Project")).toHaveLength(2);

      await user.keyboard("core");
      await waitFor(() => {
        expect(screen.queryByText("New Project")).not.toBeInTheDocument();
      });
    });
  });

  describe("when the organization holds eight projects or fewer", () => {
    /** @scenario A short project list stays a plain menu */
    it("lists the projects with no search field", async () => {
      renderShell();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Switch project" }));
      await waitFor(() => {
        expect(screen.getByText("Support Bot")).toBeInTheDocument();
      });
      expect(
        screen.queryByPlaceholderText("Search projects"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when on a Me page", () => {
    beforeEach(() => {
      mockPathname = "/me";
      // The Me pages resolve the personal workspace, so the project the
      // chrome carries there is a private one LLM Ops can never open.
      mockAmbientTeam = personalTeam;
    });

    /** @scenario The Me scope shows my name with a Personal badge */
    it("shows the user name with a Personal badge", () => {
      renderShell({ personalScope: true });

      expect(screen.getByText("Ada")).toBeInTheDocument();
      expect(screen.getByText("Personal")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Switch project" }),
      ).not.toBeInTheDocument();
    });

    /** @scenario LLM Ops opens from the personal workspace */
    it("offers LLM Ops and opens the project last worked in", async () => {
      localStorage.setItem(
        "selectedProjectSlug",
        JSON.stringify("support-bot"),
      );
      renderShell({ personalScope: true });
      const user = await openProductSwitcher();

      expect(productMenuItem("LLM Ops")).not.toHaveAttribute("data-disabled");

      await user.click(screen.getByText("LLM Ops"));

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith("/support-bot");
      });
    });

    /** @scenario LLM Ops opens a project I can reach when I have opened none yet */
    it("opens a project of a team it can open when nothing is remembered", async () => {
      renderShell({ personalScope: true });
      const user = await openProductSwitcher();

      await user.click(screen.getByText("LLM Ops"));

      await waitFor(() => {
        expect(pushMock).toHaveBeenCalledWith("/demo");
      });
    });

    /** @scenario LLM Ops stays closed when the organization holds no project for me */
    it("greys LLM Ops out when no team it can open holds a project", async () => {
      mockOrganizations = [
        { ...orgA, teams: [{ ...teamA, projects: [] }, personalTeam] },
      ];
      renderShell({ personalScope: true });
      await openProductSwitcher();

      expect(productMenuItem("LLM Ops")).toHaveAttribute("data-disabled");
    });
  });

  describe("when on a Gateway page", () => {
    /** @scenario Gateway and Governance carry no scope control */
    it("shows no project chip and no personal badge", () => {
      mockPathname = "/gateway/virtual-keys";
      renderShell();

      expect(
        screen.queryByRole("button", { name: "Switch project" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Personal")).not.toBeInTheDocument();
    });
  });

  describe("when a page asks for the collapsed sidebar", () => {
    /** @scenario The sidebar ignores the page's auto-hide request in the new modes */
    it("keeps the sidebar expanded", () => {
      renderShell({ compactMenu: true });

      expect(screen.getByText("Quick Search")).toBeVisible();
      expect(screen.getByLabelText("Quick Search")).toBeInTheDocument();
    });
  });
});
