/**
 * @vitest-environment jsdom
 * @see modules/navigation/specs/command-bar-products.feature
 */

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { productFromPathname } from "../../../model/products.ts";
import { WithStubNavigationHost } from "../../../testing.tsx";
import { type FilteredCommands, useFilteredCommands } from "../behavior/use-filtered-commands.ts";
import type { Command } from "../model/command-bar-types.ts";
import { handleCommandSelect } from "../model/command-select-handlers.ts";

let personalFeatures: Record<string, boolean> | undefined;

/** The organization's Dashboards flags; unanswered by default, so no home moves to the library. */
let organizationFlags: unknown = { isLoading: true };

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    personalWorkspaceFeatures: { get: { useQuery: () => ({ data: personalFeatures }) } },
    featureFlag: { isEnabledForEachOrganization: { useQuery: () => organizationFlags } },
  },
}));

const ON = { enabled: true, isLoading: false };
const OFF = { enabled: false, isLoading: false };
const ORGANIZATION = { id: "org_1", name: "Acme", teams: [] };
const PERSONAL_TEAM = {
  id: "team_me",
  name: "Me",
  slug: "me-team",
  isPersonal: true,
  ownerUserId: "user_1",
  projects: [{ id: "project_me", slug: "me-project", name: "Me" }],
};

type CommandsOptions = {
  query: string;
  reachable: { governance: boolean; gateway: boolean };
  codingAgentSessions?: boolean;
  dashboards?: boolean;
  projectKind?: string;
};

function filteredFor({
  query,
  reachable,
  codingAgentSessions = false,
  dashboards = false,
  projectKind,
}: CommandsOptions): FilteredCommands {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WithStubNavigationHost
      readings={{
        organization: ORGANIZATION,
        organizations: [ORGANIZATION],
        currentUserId: "user_1",
        openableTeams: [PERSONAL_TEAM],
        project: {
          id: "project_1",
          slug: "demo",
          name: "Demo",
          ...(projectKind ? { kind: projectKind } : {}),
          lastCodingAgentSessionAt: codingAgentSessions ? new Date().toISOString() : undefined,
        },
        pathname: "/demo",
        permissions: [
          "traces:view",
          ...(reachable.gateway ? ["virtualKeys:view"] : []),
          ...(reachable.governance ? ["governance:view"] : []),
          ...(dashboards ? ["analytics:view"] : []),
        ],
        flags: {
          release_ui_ai_gateway_menu_enabled: reachable.gateway ? ON : OFF,
          release_ui_ai_governance_enabled: ON,
          release_ui_governance_billed_cost_enabled: OFF,
          release_dashboards: dashboards ? ON : OFF,
        },
      }}
    >
      {children}
    </WithStubNavigationHost>
  );
  const { result } = renderHook(
    () => useFilteredCommands({ query, isSaas: true, projectId: "project_1", isDevMode: false }),
    { wrapper },
  );
  return result.current;
}

const commandsFor = (options: CommandsOptions): Command[] => filteredFor(options).navigation;

const EVERYTHING = { governance: true, gateway: true };

describe("Quick Search across products", () => {
  describe("when a page name is typed", () => {
    /** @scenario Quick Search finds a page in another product by name */
    it("lists the Me page with its product beside it", () => {
      const sessions = commandsFor({ query: "sessions", reachable: EVERYTHING }).find((command) =>
        command.id.startsWith("product-me-"),
      );

      expect(sessions).toMatchObject({
        label: "Sessions",
        productLabel: "Coding agents",
        path: "/coding-agents/sessions",
      });
    });
  });

  describe("when a keyword is typed", () => {
    /** @scenario Quick Search finds a page in another product by keyword */
    it("finds pull requests, coding agent traces and my usage", () => {
      const labelFor = (query: string) =>
        commandsFor({ query, reachable: EVERYTHING })
          .filter((command) => command.productLabel === "Coding agents")
          .map((command) => command.label);

      expect(labelFor("pull request")).toContain("Pull Requests");
      expect(labelFor("coding agent traces")).toContain("Traces");
      expect(labelFor("my usage")).toContain("My Usage");
    });
  });

  describe("when a page of another product is chosen", () => {
    /** @scenario Choosing a page in another product switches product and navigates */
    it("navigates to the page, which puts the product in Gateway", () => {
      const virtualKeys = commandsFor({ query: "virtual keys", reachable: EVERYTHING }).find(
        (command) => command.productLabel === "Gateway",
      );
      const go = vi.fn();

      handleCommandSelect({
        cmd: virtualKeys!,
        projectSlug: "demo",
        ctx: { go, newTab: false, close: vi.fn() },
        addRecentItem: vi.fn(),
        openDrawer: vi.fn(),
        openDrawerByToken: vi.fn(),
      });

      expect(go).toHaveBeenCalledWith("/gateway/virtual-keys");
      expect(productFromPathname("/gateway/virtual-keys")).toBe("gateway");
    });
  });

  describe("when switching product is typed", () => {
    /** @scenario Quick Search switches product */
    it("offers Switch to Governance, which opens the Governance home", () => {
      const switchToGovernance = commandsFor({ query: "switch", reachable: EVERYTHING }).find(
        (command) => command.label === "Switch to Governance",
      );

      expect(switchToGovernance?.path).toBe("/governance");
    });
  });

  describe("when a product is not reachable", () => {
    /** @scenario A product I cannot reach is not offered in Quick Search */
    it("leaves out its switch command and its pages", () => {
      const commands = commandsFor({
        query: "switch",
        reachable: { governance: false, gateway: false },
      });
      const everyPage = commandsFor({
        query: "gateway",
        reachable: { governance: false, gateway: false },
      });

      expect(commands.map((command) => command.label)).not.toContain("Switch to Governance");
      expect(commands.map((command) => command.label)).not.toContain("Switch to Gateway");
      expect(everyPage.filter((command) => command.id.startsWith("product-gateway"))).toEqual([]);
    });
  });

  describe("when a Me library page is turned on", () => {
    /** @scenario Quick Search offers the Me library pages that are turned on */
    it("offers Datasets only while its feature is on", () => {
      personalFeatures = { datasets: true };
      const on = commandsFor({ query: "datasets", reachable: EVERYTHING });
      personalFeatures = undefined;
      const off = commandsFor({ query: "datasets", reachable: EVERYTHING });

      expect(on.find((command) => command.productLabel === "Coding agents")?.path).toBe(
        "/me-project/datasets",
      );
      expect(off.some((command) => command.productLabel === "Coding agents")).toBe(false);
    });
  });

  describe("when an LLM Ops page is listed", () => {
    /** @scenario Quick Search names LLM Ops beside its pages */
    it("tags project pages and recent coding agent sessions with LLM Ops", () => {
      const analytics = commandsFor({ query: "analytics", reachable: EVERYTHING }).find(
        (command) => command.id === "nav-analytics",
      );
      const sessions = commandsFor({
        query: "sessions",
        reachable: EVERYTHING,
        codingAgentSessions: true,
      }).find((command) => command.productLabel === "LLM Ops");

      expect(analytics?.productLabel).toBe("LLM Ops");
      expect(sessions?.path).toBe("/[project]/sessions");
    });
  });

  describe("when the Analytics page is listed", () => {
    const analyticsPath = (options: { dashboards: boolean; projectKind?: string }) =>
      commandsFor({ query: "analytics", reachable: EVERYTHING, ...options }).find(
        (command) => command.id === "nav-analytics",
      )?.path;

    /** @scenario "AC3r Quick Search opens the same Analytics destination as the sidebar" */
    it("opens Dashboards when the sidebar entry would", () => {
      expect(analyticsPath({ dashboards: true })).toBe("/[project]/dashboards");
    });

    /** @scenario "AC3r Quick Search opens the same Analytics destination as the sidebar" */
    it("opens analytics when Dashboards is out of reach", () => {
      expect(analyticsPath({ dashboards: false })).toBe("/[project]/analytics");
    });

    const labelled = (options: { dashboards: boolean }) =>
      commandsFor({ query: "analytics", reachable: EVERYTHING, ...options }).map(
        (command) => command.label,
      );

    /** @scenario Quick Search replaces Analytics with Dashboards when Dashboards is released */
    it("shows Dashboards instead of Analytics when Dashboards is reachable", () => {
      const labels = labelled({ dashboards: true });

      expect(labels).toContain("Dashboards");
      expect(labels).not.toContain("Analytics");
    });

    /** @scenario Quick Search keeps Analytics while Dashboards is not reachable */
    it("keeps Analytics and no Dashboards entry when Dashboards is out of reach", () => {
      const labels = labelled({ dashboards: false });

      expect(labels).toContain("Analytics");
      expect(labels).not.toContain("Dashboards");
    });

    /** @scenario "AC3r Quick Search opens the same Analytics destination as the sidebar" */
    it("opens analytics for an aggregate project", () => {
      expect(analyticsPath({ dashboards: true, projectKind: "aggregate" })).toBe(
        "/[project]/analytics",
      );
    });
  });

  describe("when a dashboard is to be created", () => {
    const createDashboard = ({
      query = "new dashboard",
      area,
      dashboards = true,
    }: {
      query?: string;
      area: "open" | "legacy";
      dashboards?: boolean;
    }) => {
      const enabledByOrganizationId = area === "open" ? { [ORGANIZATION.id]: true } : {};
      organizationFlags = { data: { enabledByOrganizationId }, isLoading: false };
      try {
        return filteredFor({ query, reachable: EVERYTHING, dashboards }).actions.find(
          (command) => command.id === "action-create-dashboard",
        );
      } finally {
        organizationFlags = { isLoading: true };
      }
    };

    /** @scenario Quick Search creates a dashboard where the Dashboards entry leads */
    it("offers Create a dashboard, which opens the library with its create dialog", () => {
      const command = createDashboard({ area: "open" });
      const go = vi.fn();

      handleCommandSelect({
        cmd: command!,
        projectSlug: "demo",
        ctx: { go, newTab: false, close: vi.fn() },
        addRecentItem: vi.fn(),
        openDrawer: vi.fn(),
        openDrawerByToken: vi.fn(),
      });

      expect(command?.label).toBe("Create a dashboard");
      expect(go).toHaveBeenCalledWith("/dashboards?new=1");
    });

    /** @scenario Quick Search creates a dashboard where the Dashboards entry leads */
    it("is found by create, analytics and chart too", () => {
      for (const query of ["create", "analytics", "chart"]) {
        expect(createDashboard({ query, area: "open" })?.label).toBe("Create a dashboard");
      }
    });

    /** @scenario No Create a dashboard in Quick Search without the library */
    it("offers none with the library off, nor while Dashboards is out of reach", () => {
      expect(createDashboard({ area: "legacy" })).toBeUndefined();
      expect(createDashboard({ area: "open", dashboards: false })).toBeUndefined();
    });
  });
});
