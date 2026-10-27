/**
 * @vitest-environment jsdom
 * @see modules/navigation/specs/command-bar-products.feature
 */

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { productFromPathname } from "../../../model/products.ts";
import { WithStubNavigationHost } from "../../../testing.tsx";
import { useFilteredCommands } from "../behavior/use-filtered-commands.ts";
import type { Command } from "../model/command-bar-types.ts";
import { handleCommandSelect } from "../model/command-select-handlers.ts";

let personalFeatures: Record<string, boolean> | undefined;

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    personalWorkspaceFeatures: { get: { useQuery: () => ({ data: personalFeatures }) } },
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

function commandsFor({
  query,
  reachable,
  codingAgentSessions = false,
}: {
  query: string;
  reachable: { governance: boolean; gateway: boolean };
  codingAgentSessions?: boolean;
}): Command[] {
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
          lastCodingAgentSessionAt: codingAgentSessions ? new Date().toISOString() : undefined,
        },
        pathname: "/demo",
        permissions: [
          "traces:view",
          ...(reachable.gateway ? ["virtualKeys:view"] : []),
          ...(reachable.governance ? ["governance:view"] : []),
        ],
        flags: {
          release_ui_ai_gateway_menu_enabled: reachable.gateway ? ON : OFF,
          release_ui_ai_governance_enabled: ON,
          release_ui_governance_billed_cost_enabled: OFF,
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
  return result.current.navigation;
}

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
        productLabel: "Me",
        path: "/me/sessions",
      });
    });
  });

  describe("when a keyword is typed", () => {
    /** @scenario Quick Search finds a page in another product by keyword */
    it("finds pull requests, coding agent traces and my usage", () => {
      const labelFor = (query: string) =>
        commandsFor({ query, reachable: EVERYTHING })
          .filter((command) => command.productLabel === "Me")
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

      expect(on.find((command) => command.productLabel === "Me")?.path).toBe(
        "/me-project/datasets",
      );
      expect(off.some((command) => command.productLabel === "Me")).toBe(false);
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
});
