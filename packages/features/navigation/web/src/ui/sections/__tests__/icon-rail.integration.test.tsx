/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/icon-rail-navigation.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let orgFlags: Record<string, Record<string, boolean>> = {};

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    featureFlag: {
      isEnabledForEachOrganization: {
        useQuery: (input: { flag: string }) => ({
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

import { SHELL_SIDEBAR_WIDTH_EXPANDED } from "../../../model/shell-layout";
import { WithStubNavigationHost, type StubNavigationReadings } from "../../../testing";
import { ICON_RAIL_WIDTH } from "../icon-rail";
import { NavigationShell } from "../navigation-shell";

const teamA = {
  id: "team_1",
  name: "Core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1" }],
  projects: [{ id: "project_1", slug: "demo", name: "Demo", isPersonal: false }],
};
const orgA = { id: "org_1", name: "ACME", teams: [teamA] };

const navigateMock = vi.fn();

const BASE_READINGS: StubNavigationReadings = {
  organizations: [orgA],
  organization: orgA,
  project: teamA.projects[0],
  team: teamA,
  openableTeams: [teamA],
  currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
  isLoading: false,
  pathname: "/demo",
  permissions: ["organization:view", "virtualKeys:view", "governance:view"],
  flags: {
    release_ui_ai_gateway_menu_enabled: { enabled: true, isLoading: false },
    release_ui_ai_governance_enabled: { enabled: true, isLoading: false },
  },
  commandBar: { shortcut: "⌘K", open: vi.fn(), trigger: null },
};

function renderShell(readings: Partial<StubNavigationReadings> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{ ...BASE_READINGS, ...readings }}
        actions={{ navigate: navigateMock }}
      >
        <NavigationShell mode="icon-rail">
          <div data-testid="page-body" />
        </NavigationShell>
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
}

const railTile = (name: string) =>
  within(screen.getByRole("navigation", { name: "Products" })).queryByRole("button", { name });

beforeEach(() => {
  orgFlags = {
    release_ui_ai_governance_enabled: { org_1: true },
    release_ui_ai_gateway_menu_enabled: { org_1: true },
  };
  navigateMock.mockReset();
  localStorage.clear();
});

afterEach(() => cleanup());

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

      expect(railTile("LLM Ops")).toHaveStyle({ backgroundColor: "var(--chakra-colors-bg-panel)" });
      expect(railTile("Gateway")).not.toHaveStyle({ backgroundColor: "var(--chakra-colors-bg-panel)" });
    });
  });

  describe("when a page renders beside the rail", () => {
    /** @scenario The page keeps its right edge inside the window */
    it("gives the page the window less the rail and the sidebar", () => {
      renderShell();

      // Production emits `calc(100vw - Npx)`; jsdom resolves that against its
      // own `window.innerWidth` rather than echoing the calc string back, so
      // the assertion reads the same resolved pixel width jsdom computed.
      const inset =
        Number.parseInt(SHELL_SIDEBAR_WIDTH_EXPANDED, 10) + Number.parseInt(ICON_RAIL_WIDTH, 10);
      const roomForThePage = window.innerWidth - inset;

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
      renderShell({
        flags: {
          release_ui_ai_gateway_menu_enabled: { enabled: true, isLoading: false },
          release_ui_ai_governance_enabled: { enabled: false, isLoading: false },
        },
      });

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
        expect(navigateMock).toHaveBeenCalledWith("/gateway/virtual-keys");
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
        expect(navigateMock).toHaveBeenCalledWith("/settings");
      });
    });
  });

  describe("when the icon-rail top bar renders", () => {
    /** @scenario The top bar drops the product dropdown in the icon-rail mode */
    it("has no product dropdown but keeps the organization and the scope", () => {
      renderShell();

      expect(screen.queryByRole("button", { name: "Switch product" })).not.toBeInTheDocument();
      expect(screen.getByText("ACME")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Switch project" })).toBeInTheDocument();
    });
  });
});
