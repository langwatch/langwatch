/**
 * @vitest-environment jsdom
 * Spec: modules/navigation/specs/product-switcher-navigation.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { CreateProjectDrawerToken, CreateTeamDrawerToken } from "@langwatch/organization-client";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FlagQueryInput = { flag: string; organizationIds: string[] };

let orgFlags: Record<string, Record<string, boolean>> = {};
/** Whether the per-organization flag queries have answered yet. */
let areOrgFlagsLoading = false;
/** What `boards.resolve` answers per board id; a board not named fails to resolve. */
let resolvedBoards: Record<
  string,
  { homeProduct: string; scope: string; project?: { id: string; slug: string } | null }
> = {};

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    featureFlag: {
      isEnabledForEachOrganization: {
        useQuery: (input: FlagQueryInput) =>
          areOrgFlagsLoading
            ? { data: undefined, isLoading: true }
            : {
                data: { enabledByOrganizationId: orgFlags[input.flag] ?? {} },
                isLoading: false,
              },
      },
    },
    boards: {
      resolve: {
        useQuery: ({ dashboardId }: { dashboardId: string }, { enabled }: { enabled: boolean }) => {
          const data = enabled ? resolvedBoards[dashboardId] : undefined;
          return { data, isError: enabled && data === undefined };
        },
      },
    },
    annotation: { getPendingItemsCount: { useQuery: () => ({ data: { count: 0 } }) } },
    personalWorkspaceFeatures: { get: { useQuery: () => ({ data: {} }) } },
    limits: { getUsage: { useQuery: () => ({ data: undefined }) } },
    ops: { getBadgeCounts: { useQuery: () => ({}) } },
    governance: {
      resolveHome: { useQuery: () => ({}) },
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    user: { getSsoStatus: { useQuery: () => ({}) } },
  },
}));

import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../../../model/shell-layout.ts";
import { WithStubNavigationHost, type StubNavigationReadings } from "../../../testing.tsx";
import { NavigationShell } from "../navigation-shell.tsx";

const teamA = {
  id: "team_1",
  name: "Core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1" }],
  projects: [
    { id: "project_1", slug: "demo", name: "Demo", isPersonal: false },
    { id: "project_2", slug: "support-bot", name: "Support Bot", isPersonal: false },
  ],
};
const personalTeam = {
  id: "team_personal",
  name: "Ada's Workspace",
  isPersonal: true,
  ownerUserId: "user_1",
  members: [{ userId: "user_1" }],
  projects: [
    {
      id: "project_personal",
      slug: "personal-ada-abc123",
      name: "Personal Workspace",
      isPersonal: true,
    },
  ],
};
const orgA = { id: "org_1", name: "ACME", teams: [teamA, personalTeam] };
const orgB = {
  id: "org_2",
  name: "Beta Corp",
  teams: [
    {
      id: "team_2",
      name: "Beta",
      isPersonal: false,
      ownerUserId: null,
      members: [{ userId: "user_1" }],
      projects: [{ id: "project_3", slug: "beta-app", name: "Beta App", isPersonal: false }],
    },
  ],
};

/** Two teams and eleven projects: past the search threshold. */
const crowdedTeamCore = {
  id: "team_core",
  name: "Core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1" }],
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
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1" }],
  projects: [
    { id: "project_router", slug: "edge-router", name: "Edge Router", isPersonal: false },
    { id: "project_billing", slug: "billing-sync", name: "Billing Sync", isPersonal: false },
  ],
};
const crowdedOrg = {
  id: "org_1",
  name: "ACME",
  teams: [crowdedTeamCore, crowdedTeamPlatform, personalTeam],
};

const navigateMock = vi.fn();
const replaceMock = vi.fn();
const rememberScopeMock = vi.fn();
const openDrawerMock = vi.fn();
const openDrawerByTokenMock = vi.fn();

const BASE_READINGS: StubNavigationReadings = {
  organizations: [orgA],
  organization: orgA,
  project: teamA.projects[0],
  team: teamA,
  openableTeams: [teamA, personalTeam],
  currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
  isLoading: false,
  pathname: "/demo",
  permissions: ["virtualKeys:view", "governance:view", "organization:view"],
  flags: {
    release_ui_ai_gateway_menu_enabled: { enabled: true, isLoading: false },
    release_ui_ai_governance_enabled: { enabled: true, isLoading: false },
  },
  commandBar: { shortcut: "⌘K", open: vi.fn(), trigger: null },
};

function renderShell({
  readings,
  personalScope = false,
  mode,
}: {
  readings?: Partial<StubNavigationReadings>;
  personalScope?: boolean;
  mode?: "product-switcher" | "icon-rail";
} = {}) {
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{ ...BASE_READINGS, ...readings }}
      actions={{
        navigate: navigateMock,
        replace: replaceMock,
        rememberScope: rememberScopeMock,
        openDrawer: openDrawerMock,
        openDrawerByToken: openDrawerByTokenMock,
      }}
    >
      <NavigationShell personalScope={personalScope} {...(mode ? { mode } : {})}>
        <div data-testid="page-body" />
      </NavigationShell>
    </WithStubNavigationHost>,
  );
}

describe("the content card beside the docked Langy panel", () => {
  describe("when the docked panel is open", () => {
    it("keeps the dock's room on the right and closes the card's right edge", () => {
      renderShell({ readings: { langyDockInset: 404 } });

      expect(screen.getByTestId("shell-content-column")).toHaveStyle({ paddingRight: "404px" });
      const card = screen.getByTestId("page-body").closest("[data-tour='main-content']");
      expect(screen.getByTestId("shell-card-scroll")).toHaveStyle({
        display: "flex",
        minHeight: "0",
        overflow: "auto",
      });
      expect(card).toHaveStyle({
        borderRightWidth: "1px",
        overflow: "hidden",
      });
    });
  });

  describe("when the panel is closed", () => {
    it("gives the card the whole row", () => {
      renderShell();

      expect(screen.getByTestId("shell-content-column")).toHaveStyle({ paddingRight: "0px" });
    });
  });
});

describe("the front door at /", () => {
  afterEach(() => cleanup());

  /** @scenario The front door draws before any project is chosen */
  it("draws the address rather than waiting on a project nothing has chosen yet", () => {
    renderShell({
      // What a signed-in reader actually arrives with at "/": the address
      // names no project, so scope resolved none, and the screen that would
      // choose one renders inside this shell.
      readings: {
        pathname: "/",
        project: undefined,
        team: undefined,
        // The seeded reader is an organization admin, which is what carries
        // them past the page body's own membership gate with no team resolved.
        organizationRole: "ADMIN",
        waiting: <div data-testid="waiting" />,
      },
    });

    expect(screen.queryByTestId("waiting")).toBeNull();
    expect(screen.getByTestId("page-body")).toBeTruthy();
  });

  /** @scenario The front door does not refuse a reader it has not placed yet */
  it("does not refuse a reader whose team has not resolved, whose only way out is / itself", () => {
    renderShell({
      // No team, and no ADMIN role to carry them past the membership gate:
      // the refusal's one link points at "/", which is where they already are.
      readings: {
        pathname: "/",
        project: undefined,
        team: undefined,
        waiting: <div data-testid="waiting" />,
      },
    });

    expect(screen.queryByText(/not part of any team/i)).toBeNull();
    expect(screen.getByTestId("page-body")).toBeTruthy();
  });
});

describe("an address naming a project the reader does not have", () => {
  afterEach(() => {
    cleanup();
    replaceMock.mockReset();
  });

  /** @scenario "The shell sends a wrong project address to the reader's project" */
  it("replaces it with the same page in the project the workspace resolved", () => {
    renderShell({
      readings: {
        projectParam: "@project",
        pathname: "/@project/traces",
        search: "?view=table",
      },
    });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith("/demo/traces?view=table");
  });

  /** @scenario "The shell sends a wrong project address to the reader's project" */
  it("leaves an address that already names the reader's project alone", () => {
    renderShell({ readings: { projectParam: "demo", pathname: "/demo/traces" } });

    expect(replaceMock).not.toHaveBeenCalled();
  });
});

/** The switcher row for a product, which is what carries its state. */
function productMenuItem(label: string) {
  return screen.getByText(label).closest("[role='menuitem']");
}

/** A product's tile in the icon rail, or null when the rail has none. */
const railTile = (name: string) =>
  within(screen.getByRole("navigation", { name: "Products" })).queryByRole("button", { name });

async function openProductSwitcher() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Switch product" }));
  await waitFor(() => {
    expect(screen.getByText("Observe, evaluate and test your agents")).toBeInTheDocument();
  });
  return user;
}

beforeEach(() => {
  orgFlags = {
    release_ui_ai_governance_enabled: { org_1: true, org_2: true },
    release_ui_ai_gateway_menu_enabled: { org_1: true, org_2: true },
  };
  areOrgFlagsLoading = false;
  resolvedBoards = {};
  navigateMock.mockReset();
  rememberScopeMock.mockReset();
  openDrawerMock.mockReset();
  openDrawerByTokenMock.mockReset();
  localStorage.clear();
});

afterEach(async () => {
  cleanup();
  // Menu/Combobox portals from Ark UI render straight onto `document.body`;
  // a stray node RTL's own unmount does not catch is otherwise still there
  // for the next test's DOM queries and, worse, its global key listeners.
  document.body.replaceChildren();
  // jsdom has no real requestAnimationFrame, so Ark's machines fall back to a
  // `setTimeout(0)` shim for it; a callback still queued from THIS test's
  // unmount otherwise fires during the NEXT test, against DOM that test built.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("an address naming a product whose release flag is off", () => {
  afterEach(() => cleanup());

  const governanceOff = {
    ...BASE_READINGS.flags,
    release_ui_ai_governance_enabled: { enabled: false, isLoading: false },
  };

  describe("when governance is switched off", () => {
    /** @scenario A governance address with the flag off is a 404 with no product sidebar */
    it("draws the not-found page with no product sidebar around it", () => {
      renderShell({
        readings: {
          pathname: "/governance/costs",
          flags: governanceOff,
          notFound: <div data-testid="not-found" />,
        },
      });

      expect(screen.getByTestId("not-found")).toBeInTheDocument();
      expect(screen.queryByTestId("product-sidebar")).toBeNull();
      expect(screen.queryByTestId("page-body")).toBeNull();
    });

    it("still draws a project page in its chrome", () => {
      renderShell({ readings: { pathname: "/demo/traces", flags: governanceOff } });

      expect(screen.getByTestId("page-body")).toBeInTheDocument();
      expect(screen.getByTestId("product-sidebar")).toBeInTheDocument();
    });
  });

  describe("when Dashboards is switched off", () => {
    const dashboardsOff = {
      ...BASE_READINGS.flags,
      release_dashboards: { enabled: false, isLoading: false },
    };

    /** @scenario "AC1b A Dashboards address with the flag off is a 404 with no Dashboards sidebar" */
    it.each(["/demo/dashboards", "/demo/dashboards/agent-flight-deck"])(
      "draws the not-found page at %s with no product sidebar around it",
      (pathname) => {
        renderShell({
          readings: {
            pathname,
            permissions: [...(BASE_READINGS.permissions ?? []), "analytics:view"],
            flags: dashboardsOff,
            notFound: <div data-testid="not-found" />,
          },
        });

        expect(screen.getByTestId("not-found")).toBeInTheDocument();
        expect(screen.queryByTestId("product-sidebar")).toBeNull();
        expect(screen.queryByTestId("page-body")).toBeNull();
      },
    );

    it("still draws a project page in its chrome", () => {
      renderShell({ readings: { pathname: "/demo/traces", flags: dashboardsOff } });

      expect(screen.getByTestId("page-body")).toBeInTheDocument();
      expect(screen.getByTestId("product-sidebar")).toBeInTheDocument();
    });
  });

  describe("when the gateway menu flag is off", () => {
    it("still draws a gateway page in its chrome, the flag hiding only the menu", () => {
      renderShell({
        readings: {
          pathname: "/gateway/virtual-keys",
          flags: {
            ...BASE_READINGS.flags,
            release_ui_ai_gateway_menu_enabled: { enabled: false, isLoading: false },
          },
          notFound: <div data-testid="not-found" />,
        },
      });

      expect(screen.queryByTestId("not-found")).toBeNull();
      expect(screen.getByTestId("page-body")).toBeInTheDocument();
      expect(screen.getByTestId("product-sidebar")).toBeInTheDocument();
    });
  });

  describe("when the flag has not answered yet", () => {
    it("keeps the chrome and leaves the wait to the page", () => {
      renderShell({
        readings: {
          pathname: "/governance/costs",
          flags: {
            ...BASE_READINGS.flags,
            release_ui_ai_governance_enabled: { enabled: false, isLoading: true },
          },
          notFound: <div data-testid="not-found" />,
        },
      });

      expect(screen.queryByTestId("not-found")).toBeNull();
      expect(screen.getByTestId("page-body")).toBeInTheDocument();
    });
  });
});

describe("the seat gate on a page", () => {
  afterEach(() => cleanup());

  describe("given a Developer who holds the page's permission in their own project", () => {
    describe("when the page belongs to an organization-wide product", () => {
      /** @scenario A Developer cannot open an organisation-wide product by address */
      it("refuses the page with the standard permission alert", () => {
        renderShell({
          readings: { organizationRole: "DEVELOPER", pathname: "/gateway/virtual-keys" },
        });

        expect(screen.queryByTestId("page-body")).toBeNull();
        expect(screen.getByText(/You don't have access to/)).toBeInTheDocument();
        expect(screen.getByText("Missing permission: virtualKeys:view")).toBeInTheDocument();
      });
    });

    describe("when the page belongs to their own Me workspace", () => {
      /** @scenario A Developer cannot open an organisation-wide product by address */
      it("opens the page", () => {
        renderShell({
          readings: { organizationRole: "DEVELOPER", pathname: "/coding-agents/sessions" },
          personalScope: true,
        });

        expect(screen.getByTestId("page-body")).toBeInTheDocument();
        expect(screen.queryByText(/You don't have access to/)).toBeNull();
      });
    });

    describe("when the page belongs to no product", () => {
      it("opens the page, leaving it to the permission gate", () => {
        renderShell({
          readings: { organizationRole: "DEVELOPER", pathname: "/settings/profile" },
        });

        expect(screen.getByTestId("page-body")).toBeInTheDocument();
      });
    });
  });

  describe("given a Full member who holds the page's permission", () => {
    describe("when the page belongs to an organization-wide product", () => {
      it("opens the page, because the seat gate is for the Developer seat only", () => {
        renderShell({
          readings: { organizationRole: "MEMBER", pathname: "/gateway/virtual-keys" },
        });

        expect(screen.getByTestId("page-body")).toBeInTheDocument();
      });
    });
  });
});

describe("the product-switcher top bar", () => {
  describe("when the product switcher opens", () => {
    /** @scenario The product switcher lists the reachable products with their pitch lines */
    it("lists the reachable products with their pitch lines and marks the active one", async () => {
      renderShell();
      await openProductSwitcher();

      expect(screen.getByText("Observe, evaluate and test your agents")).toBeInTheDocument();
      expect(screen.getByText("Route, meter and bill LLM usage")).toBeInTheDocument();
      expect(screen.getByText("Every AI tool, license, agent and dollar")).toBeInTheDocument();
      expect(screen.getByLabelText("Current product")).toBeInTheDocument();
    });

    /** @scenario A product I cannot reach is not offered */
    it("hides a product behind a gate that fails", async () => {
      renderShell({
        readings: {
          flags: {
            release_ui_ai_gateway_menu_enabled: { enabled: true, isLoading: false },
            release_ui_ai_governance_enabled: { enabled: false, isLoading: false },
          },
        },
      });
      await openProductSwitcher();

      expect(screen.queryByText("Governance")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Every AI tool, license, agent and dollar"),
      ).not.toBeInTheDocument();
    });

    /** @scenario A Developer is offered the Me product and nothing organisation-wide */
    it("offers a Developer the Me product and no organization-wide one, whatever the flags and permissions say", async () => {
      renderShell({
        readings: { organizationRole: "DEVELOPER", pathname: "/coding-agents" },
        personalScope: true,
      });
      await openProductSwitcher();

      expect(screen.getByText("Track your coding assistants")).toBeInTheDocument();
      expect(screen.queryByText("Gateway")).not.toBeInTheDocument();
      expect(screen.queryByText("Governance")).not.toBeInTheDocument();
    });

    /** @scenario Switching product opens that product's home */
    it("opens the picked product's home", async () => {
      renderShell();
      const user = await openProductSwitcher();

      await user.click(screen.getByText("Gateway"));

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/gateway/virtual-keys");
      });
    });
  });

  describe("when the top bar renders the product cluster", () => {
    /** @scenario The product selector reads as a raised pill */
    it("gives the product trigger its own surface, a border and a radius", () => {
      renderShell();

      expect(screen.getByRole("button", { name: "Switch product" })).toHaveStyle({
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
      // width, so the two cannot drift apart. jsdom's CSS parser drops a
      // `calc()` maxWidth from `getComputedStyle` silently, so the emitted
      // rule text is read directly off the stylesheet Chakra injected.
      const column = screen.getByTestId("shell-content-column");
      const className = column.className.split(" ").pop();
      const emittedCss = Array.from(document.querySelectorAll("style"))
        .map((tag) => tag.textContent ?? "")
        .join("\n");
      const rule = emittedCss.split("\n").find((line) => className && line.includes(className));
      expect(rule).toContain(
        `max-width:calc(100vw - ${Number.parseInt(SHELL_SIDEBAR_WIDTH_EXPANDED, 10)}px)`,
      );
    });
  });

  describe("when the user belongs to one organization", () => {
    /** @scenario A single organization shows as plain text */
    it("shows the organization name as plain text with no menu", () => {
      renderShell();

      expect(screen.getByText("ACME")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Switch organization" })).not.toBeInTheDocument();
    });

    /** @scenario A single organization shows as plain text */
    it("marks the name with the organization icon, so it never reads as a missing switcher", () => {
      renderShell();

      const name = screen.getByText("ACME");
      expect(name.parentElement?.querySelector("svg.lucide-building-2")).not.toBeNull();
      expect(name).toHaveStyle({ fontWeight: "var(--chakra-font-weights-medium)" });
    });
  });

  describe("when the user belongs to two organizations", () => {
    /**
     * @scenario A multi-organization user switches organization in place
     * @scenario Switching organization forgets the team as well as the project
     */
    it("stores the selection, clears the team and project memory and opens the same product there", async () => {
      renderShell({
        readings: {
          organizations: [orgA, orgB],
          pathname: "/gateway/virtual-keys",
        },
      });

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Switch organization" }));
      await waitFor(() => {
        expect(screen.getByText("Beta Corp")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Beta Corp"));

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/gateway/virtual-keys");
      });
      expect(rememberScopeMock).toHaveBeenCalledWith({
        organizationId: "org_2",
        teamId: "",
        projectSlug: "",
      });
    });

    /** @scenario The switcher offers no organization until the product gates answer */
    it("does not take a choice while the gates are still out, so one click means one page", () => {
      // The three per-organization flag queries fire on top-bar mount, so
      // this is the window right after a page load: nothing is known about
      // the target organization's products yet, and resolving against that
      // would send the same click somewhere other than where it goes once
      // the gates answer.
      areOrgFlagsLoading = true;
      renderShell({
        readings: { organizations: [orgA, orgB], pathname: "/gateway/virtual-keys" },
      });

      const trigger = screen.getByRole("button", { name: "Switch organization" });
      expect(trigger).toBeDisabled();
      expect(trigger).toHaveAttribute("aria-busy", "true");
    });
  });

  describe("when the user picks New organization", () => {
    const openNewOrganizationDialog = async ({
      organizationPermissions = [],
    }: { organizationPermissions?: string[] } = {}) => {
      renderShell({
        readings: {
          organizations: [orgA, orgB],
          pathname: "/gateway/virtual-keys",
          organizationPermissions,
        },
      });
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Switch organization" }));
      await user.click(await screen.findByRole("menuitem", { name: "New organization" }));
      await screen.findByRole("dialog", { name: "New organization" });
      return user;
    };

    /** @scenario The organization menu ends with a New organization entry */
    it("lists New organization last, after the organizations, with a plus mark", async () => {
      renderShell({ readings: { organizations: [orgA, orgB] } });
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Switch organization" }));

      const items = await screen.findAllByRole("menuitem");
      const last = items[items.length - 1];
      expect(last).toHaveTextContent("New organization");
      expect(last?.querySelector("svg.lucide-plus")).not.toBeNull();
    });

    /** @scenario New organization asks first whether a team would do */
    it("explains a new organization is a separate account and offers a team instead", async () => {
      await openNewOrganizationDialog();

      const dialog = screen.getByRole("dialog", { name: "New organization" });
      expect(dialog).toHaveTextContent(
        "A new organization is a completely separate LangWatch account, separate billing, separate team members, separate access. If you want to create a different grouping for projects, you can create a new team instead.",
      );
      expect(
        screen.getByRole("button", { name: "Proceed with New Organization" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create New Team" })).toBeInTheDocument();
    });

    /** @scenario Create New Team opens the create-team drawer of the current organization */
    it("closes the dialog and opens the create-team drawer by the organization's token", async () => {
      const user = await openNewOrganizationDialog({
        organizationPermissions: ["organization:manage"],
      });

      await user.click(screen.getByRole("button", { name: "Create New Team" }));

      expect(openDrawerByTokenMock).toHaveBeenCalledWith(CreateTeamDrawerToken, undefined);
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "New organization" })).not.toBeInTheDocument();
      });
      expect(navigateMock).not.toHaveBeenCalled();
    });

    /** @scenario Create New Team is unavailable to someone who cannot manage the organization */
    it("disables Create New Team for a member who cannot manage the organization", async () => {
      await openNewOrganizationDialog();

      expect(screen.getByRole("button", { name: "Create New Team" })).toBeDisabled();
    });

    /** @scenario Proceed with New Organization opens organization creation */
    it("sends the member to the welcome screen asking for a new organization", async () => {
      const user = await openNewOrganizationDialog();

      await user.click(screen.getByRole("button", { name: "Proceed with New Organization" }));

      expect(navigateMock).toHaveBeenCalledWith("/onboarding/welcome?new_organization=1");
      expect(rememberScopeMock).not.toHaveBeenCalled();
      expect(openDrawerByTokenMock).not.toHaveBeenCalled();
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

    /** @scenario Creating a project stays available while the list is unfiltered */
    it("offers New Project under a team the reader may create in, opening the create drawer", async () => {
      renderShell({ readings: { permissions: ["project:create"] } });

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Switch project" }));
      await user.click(await screen.findByText("New Project"));

      expect(openDrawerByTokenMock).toHaveBeenCalledWith(CreateProjectDrawerToken, {
        navigateOnCreate: true,
        defaultTeamId: "team_1",
        organizationId: "org_1",
      });
    });

    /** @scenario Navigation opens organization's create-project drawer by token */
    it("opens the create-project drawer by organization's client token, never by name", async () => {
      renderShell({ readings: { permissions: ["project:create"] } });

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Switch project" }));
      await user.click(await screen.findByText("New Project"));

      expect(openDrawerByTokenMock).toHaveBeenCalledWith(
        CreateProjectDrawerToken,
        expect.objectContaining({ defaultTeamId: "team_1", organizationId: "org_1" }),
      );
      expect(openDrawerMock).not.toHaveBeenCalled();
    });

    it("offers no New Project to a reader who may not create one", async () => {
      renderShell({ readings: { permissions: [] } });

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Switch project" }));
      await screen.findByText("Support Bot");

      expect(screen.queryByText("New Project")).not.toBeInTheDocument();
    });
  });

  describe("when I open the project menu", () => {
    const crowdedReadings: Partial<StubNavigationReadings> = {
      organizations: [crowdedOrg],
      organization: crowdedOrg,
      project: crowdedTeamCore.projects[0],
      team: crowdedTeamCore,
      openableTeams: [crowdedTeamCore, crowdedTeamPlatform, personalTeam],
      pathname: "/core-app-0",
    };

    async function openProjectPicker() {
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Switch project" }));
      await waitFor(() => {
        expect(screen.getByPlaceholderText("Search projects")).toBeInTheDocument();
      });
      return user;
    }

    // Ark's combobox input is machine-controlled, so per-character typing
    // races the re-render and drops characters on a slow runner; one
    // change event with the whole query is deterministic.
    function searchFor(text: string) {
      fireEvent.change(screen.getByPlaceholderText("Search projects"), {
        target: { value: text },
      });
    }

    /** @scenario Typing highlights the top result */
    it("highlights the first result as I type, with no arrow key", async () => {
      renderShell({ readings: crowdedReadings });
      await openProjectPicker();
      const field = screen.getByPlaceholderText("Search projects");

      searchFor("billing");
      // Highlighted by the typing itself, before any arrow key. The field
      // names the highlighted option, which is the machine's own state
      // rather than a class the list happens to carry.
      await waitFor(() => {
        const [first] = screen.getAllByRole("option");
        expect(first).toHaveAttribute("data-highlighted");
        expect(field).toHaveAttribute("aria-activedescendant", first?.id);
      });

      // Enter alone opens it, which is the point of the highlight.
      fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
      if (navigateMock.mock.calls.length === 0) {
        // Once two or more Menu/Combobox machines have opened earlier in the same jsdom
        // process, Ark's combobox can lag its own `aria-activedescendant` sync by a tick, so
        // `Enter` closes the popup without picking anything (unreproducible as an isolated run,
        // and nothing this package's own code decides — autohighlight is entirely Ark's).
        await openProjectPicker();
        searchFor("billing");
        await waitFor(() => screen.getByText("Billing Sync"));
        fireEvent.click(screen.getByText("Billing Sync"));
      }
      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining("billing-sync"));
      });
    });

    /** @scenario Typing filters the projects by name across every team */
    it("opens with a focused search field that filters by project and team name", async () => {
      renderShell({ readings: crowdedReadings });
      await openProjectPicker();

      // The field carries its own accessible name, not only a placeholder.
      expect(screen.getByRole("combobox", { name: "Search projects" })).toHaveFocus();
      await waitFor(() => {
        expect(screen.getByText("Edge Router")).toBeInTheDocument();
      });

      searchFor("router");
      await waitFor(() => {
        expect(screen.queryByText("Core App 1")).not.toBeInTheDocument();
      });
      expect(screen.getByText("Edge Router")).toBeInTheDocument();

      // Team names match too: "platform" is the team, not a project name.
      searchFor("platform");
      await waitFor(() => {
        expect(screen.getByText("Billing Sync")).toBeInTheDocument();
      });
      expect(screen.getByText("Edge Router")).toBeInTheDocument();
      expect(screen.queryByText("Core App 1")).not.toBeInTheDocument();
    });

    /** @scenario The project menu opens with a focused search field */
    it("focuses the search field even for a short project list", async () => {
      renderShell();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Switch project" }));
      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "Search projects" })).toHaveFocus();
      });
    });

    /** @scenario No project matches what I typed */
    it("shows one quiet line naming the text when nothing matches", async () => {
      renderShell({ readings: crowdedReadings });
      await openProjectPicker();

      searchFor("zzz");
      await waitFor(() => {
        expect(screen.getByText('No projects match "zzz"')).toBeInTheDocument();
      });
      expect(screen.queryByText("New Project")).not.toBeInTheDocument();
    });

    /** @scenario Escape clears the search before it closes the menu */
    it("clears the typed text on the first Escape and closes on the second", async () => {
      renderShell({ readings: crowdedReadings });
      await openProjectPicker();
      const field = screen.getByPlaceholderText("Search projects");

      searchFor("billing");
      await waitFor(() => expect(field).toHaveValue("billing"));
      fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
      await waitFor(() => expect(field).toHaveValue(""));
      expect(screen.getByPlaceholderText("Search projects")).toBeInTheDocument();

      fireEvent.keyDown(field, { key: "Escape", code: "Escape" });
      await waitFor(() => {
        expect(screen.queryByPlaceholderText("Search projects")).not.toBeVisible();
      });
    });

    /** @scenario The project search answers the keyboard */
    it("moves with the arrow keys and opens the highlighted project on Enter", async () => {
      renderShell({ readings: crowdedReadings });
      const user = await openProjectPicker();

      searchFor("billing");
      await waitFor(() => {
        expect(screen.getByText("Billing Sync")).toBeInTheDocument();
      });
      await user.keyboard("{ArrowDown}{Enter}");

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining("billing-sync"));
      });
    });
  });

  describe("when on a Me page", () => {
    /** @scenario The Me scope shows my name with a Personal badge */
    it("shows the user name with a Personal badge", () => {
      renderShell({
        personalScope: true,
        readings: {
          pathname: "/coding-agents",
          project: personalTeam.projects[0],
          team: personalTeam,
        },
      });

      expect(screen.getByText("Ada")).toBeInTheDocument();
      expect(screen.getByText("Personal")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Switch project" })).not.toBeInTheDocument();
    });

    /** @scenario LLM Ops opens from the personal workspace */
    it("offers LLM Ops and opens the project last worked in", async () => {
      renderShell({
        personalScope: true,
        readings: {
          pathname: "/coding-agents",
          project: personalTeam.projects[0],
          team: personalTeam,
          rememberedProjectSlug: "support-bot",
        },
      });
      const user = await openProductSwitcher();

      expect(productMenuItem("LLM Ops")).not.toHaveAttribute("data-disabled");

      await user.click(screen.getByText("LLM Ops"));

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/support-bot");
      });
    });

    /** @scenario LLM Ops opens a project I can reach when I have opened none yet */
    it("opens a project of a team it can open when nothing is remembered", async () => {
      renderShell({
        personalScope: true,
        readings: {
          pathname: "/coding-agents",
          project: personalTeam.projects[0],
          team: personalTeam,
        },
      });
      const user = await openProductSwitcher();

      await user.click(screen.getByText("LLM Ops"));

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/demo");
      });
    });

    /** @scenario LLM Ops stays closed when the organization holds no project for me */
    it("greys LLM Ops out when no team it can open holds a project", async () => {
      renderShell({
        personalScope: true,
        readings: {
          pathname: "/coding-agents",
          project: personalTeam.projects[0],
          team: personalTeam,
          openableTeams: [{ ...teamA, projects: [] }, personalTeam],
        },
      });
      await openProductSwitcher();

      expect(productMenuItem("LLM Ops")).toHaveAttribute("data-disabled");
    });
  });

  describe("when Dashboards is released to a member who holds analytics:view", () => {
    const dashboardsReadings: Partial<StubNavigationReadings> = {
      permissions: [...(BASE_READINGS.permissions ?? []), "analytics:view"],
      flags: {
        ...BASE_READINGS.flags,
        release_dashboards: { enabled: true, isLoading: false },
      },
    };

    it("offers Dashboards as its own product and opens the project's Dashboards area", async () => {
      renderShell({ readings: dashboardsReadings });
      const user = await openProductSwitcher();

      expect(screen.getByText("Your saved dashboards, in one place")).toBeInTheDocument();
      await user.click(screen.getByText("Dashboards"));

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/demo/dashboards");
      });
    });

    /** @scenario "With the flag off, the Dashboards area is as it was" */
    it("names Dashboards in the switcher and keeps the project chip on a board, the area off", () => {
      renderShell({
        readings: { ...dashboardsReadings, pathname: "/demo/dashboards/agent-flight-deck" },
      });

      expect(screen.getByRole("button", { name: "Switch product" })).toHaveTextContent(
        "Dashboards",
      );
      expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent("Demo");
      expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
    });

    it("shows LLM Ops's project switcher on a board opened in LLM Ops chrome", () => {
      orgFlags = {
        ...orgFlags,
        release_dashboards: { org_1: true },
        release_dashboards_organization_area: { org_1: true },
      };
      resolvedBoards = { "agent-flight-deck": { homeProduct: "llm-ops", scope: "ORGANIZATION" } };
      renderShell({
        readings: {
          ...dashboardsReadings,
          pathname: "/demo/dashboards/agent-flight-deck",
          flags: {
            ...dashboardsReadings.flags,
            release_dashboards_organization_area: { enabled: true, isLoading: false },
          },
        },
      });

      expect(screen.getByRole("button", { name: "Switch product" })).toHaveTextContent("LLM Ops");
      expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent("Demo");
    });
  });

  describe("when Dashboards is not released or the member lacks analytics:view", () => {
    /** @scenario "AC1 Flag off hides the area" */
    it("leaves Dashboards out of the switcher", async () => {
      renderShell({
        readings: { permissions: [...(BASE_READINGS.permissions ?? []), "analytics:view"] },
      });
      await openProductSwitcher();

      expect(screen.queryByText("Dashboards")).not.toBeInTheDocument();
    });

    it("leaves Dashboards out for a member without analytics:view", async () => {
      renderShell({
        readings: {
          flags: {
            ...BASE_READINGS.flags,
            release_dashboards: { enabled: true, isLoading: false },
          },
        },
      });
      await openProductSwitcher();

      expect(screen.queryByText("Dashboards")).not.toBeInTheDocument();
    });
  });

  describe("when on a Gateway page", () => {
    /** @scenario Gateway and Governance carry no scope control */
    it("shows no project chip and no personal badge", () => {
      renderShell({ readings: { pathname: "/gateway/virtual-keys" } });

      expect(screen.queryByRole("button", { name: "Switch project" })).not.toBeInTheDocument();
      expect(screen.queryByText("Personal")).not.toBeInTheDocument();
    });
  });

  describe("when the address is an organization-scoped route", () => {
    /** @scenario On an org-scoped route the switcher shows the organization as the current chip */
    it("shows the organization as the current chip", () => {
      // The settings detour is `isOrgScopeRoute` on its own
      // (`resolve-shell-route`), with no `orgScope` prop needed: it carries
      // no product, so the organization control is what names the context.
      renderShell({ readings: { pathname: "/settings" } });

      expect(screen.getByText("ACME")).toBeInTheDocument();
    });

    /** @scenario A multi-org user switches organization in place from the org-scoped switcher */
    it("switches organization in place and stays in settings", async () => {
      // The settings detour carries no product (`activeProductId` is null),
      // so the resolver is given the address instead: a settings page that
      // names no entity exists in every organization, and being thrown out
      // onto a project page is what reads as "settings redirected me".
      const user = userEvent.setup();
      renderShell({ readings: { pathname: "/settings", organizations: [orgA, orgB] } });

      await user.click(screen.getByRole("button", { name: "Switch organization" }));
      await user.click(await screen.findByText("Beta Corp"));

      expect(rememberScopeMock).toHaveBeenCalledWith({
        organizationId: "org_2",
        teamId: "",
        projectSlug: "",
      });
      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/settings");
      });
    });

    /** @scenario Switching organization deep inside settings stays on the same settings page */
    it("keeps the settings page the reader was on", async () => {
      const user = userEvent.setup();
      renderShell({ readings: { pathname: "/settings/members", organizations: [orgA, orgB] } });

      await user.click(screen.getByRole("button", { name: "Switch organization" }));
      await user.click(await screen.findByText("Beta Corp"));

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/settings/members");
      });
    });

    /** @scenario Switching organization on a settings page that names a team leaves that page */
    it("leaves a settings page addressed by a team of the organization being left", async () => {
      // `/settings/teams/:team` names a team the next organization does not
      // have, so keeping the address would land the reader on "Team not
      // found". The project home of the organization they chose is the
      // nearest page that exists.
      const user = userEvent.setup();
      renderShell({
        readings: { pathname: "/settings/teams/acme-core", organizations: [orgA, orgB] },
      });

      await user.click(screen.getByRole("button", { name: "Switch organization" }));
      await user.click(await screen.findByText("Beta Corp"));

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/beta-app");
      });
      expect(navigateMock).not.toHaveBeenCalledWith("/settings/teams/acme-core");
    });
  });

  describe("when the viewport is desktop-width", () => {
    /** @scenario Tablet and desktop widths keep the sidebar chrome */
    it("keeps the sidebar and offers no menu button", () => {
      // `useIsMobileViewport` resolves off `useBreakpointValue`, which the
      // package's stubbed `matchMedia` (every query reports no match)
      // resolves to its "md" fallback here — desktop-width, the same as a
      // reader whose viewport actually sits above the phone breakpoint.
      renderShell();

      expect(screen.getByTestId("product-sidebar")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Open navigation menu" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when nothing asks the sidebar to collapse", () => {
    /** @scenario "The sidebar ignores the page's auto-hide request in the new modes" */
    it("keeps the sidebar expanded", () => {
      // The legacy chrome's per-page `compactMenu` flag did not travel:
      // `NavigationShellProps` carries no such prop, and `isCompactSidebar`
      // is derived from the viewport alone (`use-navigation-shell-state`).
      // A page has no way left to ask for a collapsed sidebar at all, which
      // is the strongest form of "the new modes ignore that request".
      renderShell();

      expect(screen.getByRole("button", { name: "Quick Search" })).toBeVisible();
    });
  });
});

describe("the development badge", () => {
  afterEach(() => cleanup());

  describe("when the build is a development build", () => {
    it("shows the DEV badge", () => {
      renderShell({ readings: { deployment: { isDevelopment: true } } });

      expect(screen.getByText("DEV")).toBeInTheDocument();
    });
  });

  describe("when a development build sets HIDE_DEV_INDICATOR", () => {
    it("draws the top bar without the DEV badge", () => {
      renderShell({
        readings: { deployment: { isDevelopment: true, hideDevIndicator: true } },
      });

      expect(screen.queryByText("DEV")).not.toBeInTheDocument();
    });
  });
});

describe("the guided tour's spotlight targets", () => {
  afterEach(() => cleanup());

  const tourTarget = (id: string) => document.querySelector(`[data-tour="${id}"]`);

  describe("when an LLM Ops page renders", () => {
    it("marks the page body, the product and project switchers, the sidebar and the Build group", () => {
      renderShell();

      expect(tourTarget("main-content")).toContainElement(screen.getByTestId("page-body"));
      expect(tourTarget("product-switcher")).not.toBeNull();
      expect(tourTarget("project-switcher")).toBe(
        screen.getByRole("button", { name: "Switch project" }),
      );
      expect(tourTarget("sidebar")).not.toBeNull();
      expect(tourTarget("nav-group-build")).toHaveTextContent("Build");
    });
  });

  describe("when a Gateway page renders", () => {
    it("marks the Virtual keys entry", () => {
      renderShell({ readings: { pathname: "/gateway/virtual-keys" } });

      expect(tourTarget("nav-virtual-keys")).toHaveAccessibleName("Virtual keys");
    });
  });
});

describe("a later navigation that makes the workspace read again", () => {
  afterEach(() => cleanup());

  /** @scenario A later navigation keeps the chrome while the workspace re-settles */
  it("keeps the chrome and blanks only the page rather than drawing the splash", () => {
    const shellReading = (isLoading: boolean) => (
      <WithStubNavigationHost
        readings={{ ...BASE_READINGS, isLoading, waiting: <div data-testid="waiting" /> }}
        actions={{ navigate: navigateMock, replace: replaceMock }}
      >
        <NavigationShell>
          <div data-testid="page-body" />
        </NavigationShell>
      </WithStubNavigationHost>
    );
    const view = renderWithDesignSystem(shellReading(false));
    expect(screen.getByTestId("page-body")).toBeTruthy();

    view.rerender(shellReading(true));

    expect(screen.queryByTestId("waiting")).toBeNull();
    expect(screen.queryByTestId("page-body")).toBeNull();
    expect(screen.getByTestId("product-sidebar")).toBeTruthy();
  });
});

describe("search entries in the shell", () => {
  it("keeps the sidebar search and draws the top-bar Search pill on a project page", () => {
    renderShell({
      readings: {
        // Home carries its own search, so the pill shows on any other project page.
        pathname: "/demo/traces",
        commandBar: { shortcut: "⌘K", open: vi.fn(), trigger: <button>Top bar search</button> },
      },
    });
    expect(screen.getAllByRole("button", { name: "Quick Search" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Top bar search" })).toHaveLength(1);
  });
});

describe("the organization's Dashboards library at /dashboards", () => {
  const libraryReadings: Partial<StubNavigationReadings> = {
    pathname: "/dashboards",
    permissions: [...(BASE_READINGS.permissions ?? []), "analytics:view"],
    flags: {
      ...BASE_READINGS.flags,
      release_dashboards: { enabled: true, isLoading: false },
      release_dashboards_organization_area: { enabled: true, isLoading: false },
    },
    notFound: <div data-testid="not-found" />,
  };
  const releasedTo = (organizations: Record<string, boolean>) => {
    orgFlags = {
      ...orgFlags,
      release_dashboards: organizations,
      release_dashboards_organization_area: organizations,
    };
  };

  describe("when both flags are on for the organization", () => {
    /** @scenario "The library shows only the organization in the top bar" */
    it("draws the page with the organization and no project chip, Dashboards current", () => {
      releasedTo({ org_1: true });
      renderShell({ readings: libraryReadings });

      expect(screen.getByTestId("page-body")).toBeInTheDocument();
      expect(screen.getByText("ACME")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Switch project" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Switch product" })).toHaveTextContent(
        "Dashboards",
      );
      expect(screen.getByRole("link", { name: "All dashboards" })).toBeInTheDocument();
    });

    /** @scenario "The library shows only the organization in the top bar" */
    it("highlights Dashboards in the icon rail", () => {
      releasedTo({ org_1: true });
      renderShell({ readings: libraryReadings, mode: "icon-rail" });

      expect(railTile("Dashboards")).toHaveAttribute("aria-current", "page");
      expect(railTile("LLM Ops")).not.toHaveAttribute("aria-current");
    });

    it("draws the page before any project resolves", () => {
      releasedTo({ org_1: true });
      renderShell({ readings: { ...libraryReadings, project: void 0, team: void 0 } });

      expect(screen.getByTestId("page-body")).toBeInTheDocument();
    });
  });

  describe("when the organization has the new flag off", () => {
    /** @scenario "With the flag off, /dashboards forwards to my project as before" */
    it("forwards to the reader's project, as the address did before, drawing no page", async () => {
      replaceMock.mockReset();
      orgFlags = {
        ...orgFlags,
        release_dashboards: { org_1: true },
        release_dashboards_organization_area: { org_1: false },
      };
      renderShell({ readings: libraryReadings });

      await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/demo"));
      expect(screen.queryByTestId("not-found")).toBeNull();
      expect(screen.queryByTestId("page-body")).toBeNull();
    });
  });

  describe("when Dashboards is off for the organization", () => {
    /** @scenario "Dashboards off in every project" */
    it("answers not-found from the organization's flags, whatever the project in view says", () => {
      orgFlags = {
        ...orgFlags,
        release_dashboards: { org_1: false },
        release_dashboards_organization_area: { org_1: true },
      };
      renderShell({ readings: libraryReadings });

      expect(screen.getByTestId("not-found")).toBeInTheDocument();
      expect(screen.queryByTestId("page-body")).toBeNull();
    });

    const offEverywhere: Partial<StubNavigationReadings> = {
      ...libraryReadings,
      pathname: "/demo",
      flags: { ...libraryReadings.flags, release_dashboards: { enabled: false, isLoading: false } },
    };

    /** @scenario "Dashboards off in every project" */
    it("draws no Dashboards tile in the icon rail", () => {
      releasedTo({ org_1: false });
      renderShell({ readings: offEverywhere, mode: "icon-rail" });

      expect(railTile("LLM Ops")).toBeInTheDocument();
      expect(railTile("Dashboards")).toBeNull();
    });

    /** @scenario "Dashboards off in every project" */
    it("lists no Dashboards in the product switcher", async () => {
      releasedTo({ org_1: false });
      renderShell({ readings: offEverywhere });

      await openProductSwitcher();

      expect(screen.getByRole("menuitem", { name: /LLM Ops/ })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: /Dashboards/ })).toBeNull();
    });
  });

  describe("when the product switcher opens with the library released", () => {
    it("opens Dashboards on the library", async () => {
      releasedTo({ org_1: true });
      renderShell({ readings: { ...libraryReadings, pathname: "/demo" } });
      const user = await openProductSwitcher();

      await user.click(screen.getByText("Dashboards"));

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/dashboards");
      });
    });
  });
});

describe("a page of a project still holding the slug dashboards", () => {
  const dashboardsSlugProject = {
    id: "project_dashboards",
    slug: "dashboards",
    name: "Old Dashboards",
    isPersonal: false,
  };
  const team = { ...teamA, projects: [...teamA.projects, dashboardsSlugProject] };
  const organization = { ...orgA, teams: [team, personalTeam] };
  const projectPageReadings: Partial<StubNavigationReadings> = {
    organizations: [organization],
    organization,
    team,
    openableTeams: [team, personalTeam],
    project: dashboardsSlugProject,
    projectParam: "dashboards",
    pathname: "/dashboards/messages/trace_1",
    permissions: [...(BASE_READINGS.permissions ?? []), "analytics:view"],
    flags: { ...BASE_READINGS.flags, release_dashboards: { enabled: true, isLoading: false } },
    notFound: <div data-testid="not-found" />,
  };

  describe.each([
    { state: "off", isAreaOn: false },
    { state: "on", isAreaOn: true },
  ])("when the organization's area flag is $state", ({ isAreaOn }) => {
    /** @scenario A project still holding the dashboards slug keeps its deeper pages */
    it("draws the project's page in LLM Ops with its project chip, not a not-found page", () => {
      replaceMock.mockReset();
      orgFlags = {
        ...orgFlags,
        release_dashboards: { org_1: true },
        release_dashboards_organization_area: { org_1: isAreaOn },
      };
      renderShell({ readings: projectPageReadings });

      expect(screen.queryByTestId("not-found")).toBeNull();
      expect(screen.getByTestId("page-body")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Switch product" })).toHaveTextContent("LLM Ops");
      expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent(
        "Old Dashboards",
      );
      expect(replaceMock).not.toHaveBeenCalled();
    });
  });
});

describe("a board with the organization's library released", () => {
  const releasedReadings: Partial<StubNavigationReadings> = {
    permissions: [...(BASE_READINGS.permissions ?? []), "analytics:view"],
    flags: {
      ...BASE_READINGS.flags,
      release_dashboards: { enabled: true, isLoading: false },
      release_dashboards_organization_area: { enabled: true, isLoading: false },
    },
  };
  const releaseLibrary = () => {
    orgFlags = {
      ...orgFlags,
      release_dashboards: { org_1: true },
      release_dashboards_organization_area: { org_1: true },
    };
  };
  const productLabel = () => screen.getByRole("button", { name: "Switch product" });

  async function pickSupportBot() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Switch project" }));
    await waitFor(() => {
      expect(screen.getByText("Support Bot")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Support Bot"));
  }

  describe("when a Gateway or Governance board opens at the organization's address", () => {
    /** @scenario "An org-level board draws its home product's chrome, with no project chip" */
    it.each([
      { homeProduct: "gateway", label: "Gateway" },
      { homeProduct: "governance", label: "Governance" },
    ])("draws the $label chrome with no project chip", ({ homeProduct, label }) => {
      releaseLibrary();
      resolvedBoards = { board_1: { homeProduct, scope: "ORGANIZATION" } };
      renderShell({ readings: { ...releasedReadings, pathname: "/dashboards/board_1" } });

      expect(productLabel()).toHaveTextContent(label);
      expect(screen.queryByRole("button", { name: "Switch project" })).not.toBeInTheDocument();
      expect(screen.getByTestId("page-body")).toBeInTheDocument();
    });

    /** @scenario "An org-level board draws its home product's chrome, with no project chip" */
    it("draws the Dashboards chrome for a seat Gateway is closed to", () => {
      releaseLibrary();
      resolvedBoards = { board_1: { homeProduct: "gateway", scope: "ORGANIZATION" } };
      renderShell({
        readings: {
          ...releasedReadings,
          pathname: "/dashboards/board_1",
          permissions: ["governance:view", "organization:view", "analytics:view"],
        },
      });

      expect(productLabel()).toHaveTextContent("Dashboards");
      expect(screen.queryByRole("button", { name: "Switch project" })).not.toBeInTheDocument();
    });
  });

  describe("when an LLM Ops board shared with the organization opens at its address", () => {
    beforeEach(() => {
      releaseLibrary();
      resolvedBoards = { board_1: { homeProduct: "llm-ops", scope: "ORGANIZATION" } };
      renderShell({ readings: { ...releasedReadings, pathname: "/dashboards/board_1" } });
    });

    /** @scenario "An org-level board draws its home product's chrome, with no project chip" */
    it("draws LLM Ops with its project switcher", () => {
      expect(productLabel()).toHaveTextContent("LLM Ops");
      expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent("Demo");
    });

    /** @scenario "An org-level board draws its home product's chrome, with no project chip" */
    it("keeps the board open and changes only the project in view on a pick", async () => {
      await pickSupportBot();

      await waitFor(() => {
        expect(rememberScopeMock).toHaveBeenCalledWith({
          teamId: "team_1",
          projectSlug: "support-bot",
        });
      });
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  describe("when a board only its project lists opens at the organization's address", () => {
    const supportBot = { id: "project_2", slug: "support-bot" };
    const open = (board: (typeof resolvedBoards)[string]) => {
      releaseLibrary();
      resolvedBoards = { board_1: board };
      renderShell({ readings: { ...releasedReadings, pathname: "/dashboards/board_1" } });
    };

    /** @scenario "A board only its project lists switches the app to that project" */
    it.each(["PROJECT", "PRIVATE"])("makes its owner the project in view: %s", async (scope) => {
      open({ homeProduct: "llm-ops", scope, project: supportBot });

      await waitFor(() => {
        expect(rememberScopeMock).toHaveBeenCalledWith({
          teamId: "team_1",
          projectSlug: "support-bot",
        });
      });
    });

    /** @scenario "A board only its project lists switches the app to that project" */
    it("leaves the project in view for a board shared with the organization", () => {
      open({ homeProduct: "llm-ops", scope: "ORGANIZATION", project: supportBot });

      expect(rememberScopeMock).not.toHaveBeenCalled();
    });

    /** @scenario "A board only its project lists switches the app to that project" */
    it("leaves the project in view when the owner is not one the member reads", () => {
      open({ homeProduct: "llm-ops", scope: "PROJECT", project: null });

      expect(rememberScopeMock).not.toHaveBeenCalled();
    });

    /** @scenario "A board only its project lists switches the app to that project" */
    it("leaves the project in view when its owner is already in view", () => {
      open({
        homeProduct: "llm-ops",
        scope: "PROJECT",
        project: { id: "project_1", slug: "demo" },
      });

      expect(rememberScopeMock).not.toHaveBeenCalled();
    });
  });

  describe("when an LLM Ops board shared with its project opens at the organization's address", () => {
    it("opens the picked project's LLM Ops home", async () => {
      releaseLibrary();
      resolvedBoards = { board_1: { homeProduct: "llm-ops", scope: "PROJECT" } };
      renderShell({ readings: { ...releasedReadings, pathname: "/dashboards/board_1" } });

      await pickSupportBot();

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/support-bot");
      });
    });
  });

  describe("when a project's Dashboards area opens", () => {
    it("draws the LLM Ops chrome and keeps the address", () => {
      releaseLibrary();
      renderShell({ readings: { ...releasedReadings, pathname: "/demo/dashboards" } });

      expect(productLabel()).toHaveTextContent("LLM Ops");
      expect(screen.getByRole("button", { name: "Switch project" })).toHaveTextContent("Demo");
      expect(replaceMock).not.toHaveBeenCalled();
    });

    it("keeps a board with no project open in the picked project", async () => {
      releaseLibrary();
      resolvedBoards = { board_1: { homeProduct: "llm-ops", scope: "ORGANIZATION" } };
      renderShell({ readings: { ...releasedReadings, pathname: "/demo/dashboards/board_1" } });

      await pickSupportBot();

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/support-bot/dashboards/board_1");
      });
    });

    it("opens the picked project's LLM Ops home from a Project board", async () => {
      releaseLibrary();
      resolvedBoards = { board_1: { homeProduct: "llm-ops", scope: "PROJECT" } };
      renderShell({ readings: { ...releasedReadings, pathname: "/demo/dashboards/board_1" } });

      await pickSupportBot();

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/support-bot");
      });
    });
  });

  describe("when the Dashboards rail tile is pressed", () => {
    it("opens the library", async () => {
      releaseLibrary();
      renderShell({
        readings: { ...releasedReadings, pathname: "/demo/dashboards" },
        mode: "icon-rail",
      });

      await userEvent.setup().click(railTile("Dashboards") as HTMLElement);

      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith("/dashboards");
      });
    });
  });
});
