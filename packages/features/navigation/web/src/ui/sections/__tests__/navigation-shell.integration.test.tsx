/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/product-switcher-navigation.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FlagQueryInput = { flag: string; organizationIds: string[] };

let orgFlags: Record<string, Record<string, boolean>> = {};

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    featureFlag: {
      isEnabledForEachOrganization: {
        useQuery: (input: FlagQueryInput) => ({
          data: { enabledByOrganizationId: orgFlags[input.flag] ?? {} },
        }),
      },
    },
    annotation: { getPendingItemsCount: { useQuery: () => ({ data: 0 }) } },
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

import { WithStubNavigationHost, type StubNavigationReadings } from "../../../testing";
import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../../../model/shell-layout";
import { NavigationShell } from "../navigation-shell";

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
    { id: "project_personal", slug: "personal-ada-abc123", name: "Personal Workspace", isPersonal: true },
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
const rememberScopeMock = vi.fn();

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
}: {
  readings?: Partial<StubNavigationReadings>;
  personalScope?: boolean;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{ ...BASE_READINGS, ...readings }}
        actions={{ navigate: navigateMock, rememberScope: rememberScopeMock }}
      >
        <NavigationShell personalScope={personalScope}>
          <div data-testid="page-body" />
        </NavigationShell>
      </WithStubNavigationHost>
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
    expect(screen.getByText("Observe, evaluate and test your agents")).toBeInTheDocument();
  });
  return user;
}

beforeEach(() => {
  orgFlags = {
    release_ui_ai_governance_enabled: { org_1: true, org_2: true },
    release_ui_ai_gateway_menu_enabled: { org_1: true, org_2: true },
  };
  navigateMock.mockReset();
  rememberScopeMock.mockReset();
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
      expect(screen.queryByText("Every AI tool, license, agent and dollar")).not.toBeInTheDocument();
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
  });

  describe("when the user belongs to two organizations", () => {
    /** @scenario A multi-organization user switches organization in place */
    it("stores the selection, clears the project memory and opens the same product there", async () => {
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
      expect(rememberScopeMock).toHaveBeenCalledWith({ organizationId: "org_2", projectSlug: "" });
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

    /** @scenario A large project list opens with a focused search field */
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

  describe("when the organization holds eight projects or fewer", () => {
    /** @scenario A short project list stays a plain menu */
    it("lists the projects with no search field", async () => {
      renderShell();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Switch project" }));
      await waitFor(() => {
        expect(screen.getByText("Support Bot")).toBeInTheDocument();
      });
      expect(screen.queryByPlaceholderText("Search projects")).not.toBeInTheDocument();
    });
  });

  describe("when on a Me page", () => {
    /** @scenario The Me scope shows my name with a Personal badge */
    it("shows the user name with a Personal badge", () => {
      renderShell({
        personalScope: true,
        readings: { pathname: "/me", project: personalTeam.projects[0], team: personalTeam },
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
          pathname: "/me",
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
        readings: { pathname: "/me", project: personalTeam.projects[0], team: personalTeam },
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
          pathname: "/me",
          project: personalTeam.projects[0],
          team: personalTeam,
          openableTeams: [{ ...teamA, projects: [] }, personalTeam],
        },
      });
      await openProductSwitcher();

      expect(productMenuItem("LLM Ops")).toHaveAttribute("data-disabled");
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
      expect(screen.queryByRole("button", { name: "Open navigation menu" })).not.toBeInTheDocument();
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
