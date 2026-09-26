// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * Main's page guards: the section flag, the billed-cost flag on the Platform screens, `governance:view`.
 * Specs: admin-oversight, governance-home-routing, governance-platform-placeholders features
 */
import { builtinRolePermissions } from "@langwatch/authz-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../testing.tsx";

const harness = vi.hoisted(() => ({ requested: [] as string[] }));

vi.mock("../../../behavior/governance-api.ts", () => {
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return (_input: unknown, options?: { enabled?: boolean }) => {
              if (options?.enabled !== false) harness.requested.push(path.join("."));
              return { data: undefined, isLoading: false, error: null, refetch: vi.fn() };
            };
          }
          if (property === "useMutation") {
            return () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
          }
          if (property === "useUtils") return () => node([]);
          if (["invalidate", "refetch", "fetch"].includes(property)) return vi.fn();
          return node([...path, property]);
        },
      },
    );
  const api = node([]);
  return { api, governanceApi: api };
});

import AgentsScreen from "../governance/agents.tsx";
import AnalyticsScreen from "../governance/analytics.tsx";
import AnomalyRulesScreen from "../governance/governance-anomaly-rules.screen.tsx";
import BilledScreen from "../governance/governance-billed.screen.tsx";
import OverviewScreen from "../governance/governance-overview.screen.tsx";
import InsightsScreen from "../governance/insights.tsx";
import SignalsScreen from "../governance/signals.tsx";

const SECTION_FLAG = "release_ui_ai_governance_enabled";
const BILLED_COST_FLAG = "release_ui_governance_billed_cost_enabled";
const ALL_FLAGS = [SECTION_FLAG, BILLED_COST_FLAG];
const VIEWER = ["organization:view", "governance:view"];
const ORG_ADMIN = [...builtinRolePermissions("org-admin"), ...builtinRolePermissions("admin")];
const NOT_FOUND = "This page is not here";

function renderGated(
  page: ReactElement,
  { flags = ALL_FLAGS, permissions = VIEWER }: { flags?: string[]; permissions?: string[] } = {},
) {
  return renderWithGovernanceHost(page, {
    host: fakeGovernanceHost({ enabledFlags: flags, permissions }),
  });
}

beforeEach(() => {
  harness.requested = [];
});
afterEach(cleanup);

describe("the governance section flag", () => {
  describe("when release_ui_ai_governance_enabled is off", () => {
    /** @scenario "Without the governance preview flag the page is hidden" */
    it("shows the not-found scene on /governance and reads nothing", () => {
      renderGated(<OverviewScreen />, { flags: [BILLED_COST_FLAG] });

      expect(screen.getByText(NOT_FOUND)).toBeInTheDocument();
      expect(harness.requested).toEqual([]);
    });

    it("hides every other governance page the same way", () => {
      renderGated(<AnomalyRulesScreen />, { flags: [BILLED_COST_FLAG] });

      expect(screen.getByText(NOT_FOUND)).toBeInTheDocument();
      expect(harness.requested).toEqual([]);
    });
  });

  describe("when release_ui_ai_governance_enabled is on", () => {
    it("opens the page and issues its reads", () => {
      renderGated(<AnomalyRulesScreen />, { flags: [SECTION_FLAG], permissions: ORG_ADMIN });

      expect(screen.queryByText(NOT_FOUND)).toBeNull();
      expect(harness.requested).not.toEqual([]);
    });
  });
});

describe("the governance:view grant", () => {
  describe("when the reader does not hold it", () => {
    /** @scenario "The agents page is guarded on governance:view" */
    it("names the missing grant and reads nothing", () => {
      renderGated(<AgentsScreen />, { permissions: ["organization:view"] });

      expect(screen.getByText(/Missing permission: governance:view/)).toBeInTheDocument();
      expect(screen.queryByText(NOT_FOUND)).toBeNull();
      expect(harness.requested).toEqual([]);
    });
  });

  describe("when the reader holds it", () => {
    it("opens the page and issues its reads", () => {
      renderGated(<AnomalyRulesScreen />, { permissions: ORG_ADMIN });

      expect(screen.queryByText(/Missing permission/)).toBeNull();
      expect(harness.requested).not.toEqual([]);
    });
  });
});

describe("the billed-cost flag on the Platform screens", () => {
  describe("when release_ui_governance_billed_cost_enabled is off", () => {
    /** @scenario "The Platform screens are unreachable with the billed-cost flag off" */
    it.each([
      ["Insights", <InsightsScreen key="insights" />],
      ["Analytics", <AnalyticsScreen key="analytics" />],
      ["Signals & Alerts", <SignalsScreen key="signals" />],
    ])("shows the not-found scene on %s and reads nothing", (_name, page) => {
      renderGated(page, { flags: [SECTION_FLAG] });

      expect(screen.getByText(NOT_FOUND)).toBeInTheDocument();
      expect(harness.requested).toEqual([]);
    });
  });

  describe("when release_ui_governance_billed_cost_enabled is on", () => {
    it("opens the page", () => {
      renderGated(<SignalsScreen />);

      expect(screen.getByRole("heading", { name: "Signals & Alerts" })).toBeInTheDocument();
      expect(screen.queryByText(NOT_FOUND)).toBeNull();
    });
  });
});

describe("the Billed address", () => {
  /** @scenario "The unfinished Billed address stays unavailable when Costs is enabled" */
  it("shows the not-found scene even with both flags on and the grant held", () => {
    renderGated(<BilledScreen />);

    expect(screen.getByText(NOT_FOUND)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Billed" })).toBeNull();
  });
});
