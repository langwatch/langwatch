// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * Every governance page sits behind `release_ui_ai_governance_enabled`, and Billed never opens.
 * Specs: specs/ai-gateway/governance/admin-oversight.feature, governance-home-routing.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
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
          if (property === "useUtils") return () => node([]);
          if (["invalidate", "refetch", "fetch"].includes(property)) return vi.fn();
          return node([...path, property]);
        },
      },
    );
  const api = node([]);
  return { api, governanceApi: api };
});

import AnomalyRulesScreen from "../governance/governance-anomaly-rules.screen.tsx";
import BilledScreen from "../governance/governance-billed.screen.tsx";
import OverviewScreen from "../governance/governance-overview.screen.tsx";
import SignalsScreen from "../governance/signals.tsx";

const SECTION_FLAG = "release_ui_ai_governance_enabled";
const BILLED_COST_FLAG = "release_ui_governance_billed_cost_enabled";

beforeEach(() => {
  harness.requested = [];
});
afterEach(cleanup);

describe("the governance section flag", () => {
  describe("when release_ui_ai_governance_enabled is off", () => {
    /** @scenario "Without the governance preview flag the page is hidden" */
    it("shows the not-found scene on /governance and reads nothing", () => {
      renderWithGovernanceHost(<OverviewScreen />, {
        host: fakeGovernanceHost({ enabledFlags: [BILLED_COST_FLAG] }),
      });

      expect(screen.getByText("This page is not here")).toBeInTheDocument();
      expect(harness.requested).toEqual([]);
    });

    it("hides every other governance page the same way", () => {
      renderWithGovernanceHost(<AnomalyRulesScreen />, {
        host: fakeGovernanceHost({ enabledFlags: [BILLED_COST_FLAG] }),
      });

      expect(screen.getByText("This page is not here")).toBeInTheDocument();
      expect(harness.requested).toEqual([]);
    });
  });

  describe("when release_ui_ai_governance_enabled is on", () => {
    it("opens the page", () => {
      renderWithGovernanceHost(<SignalsScreen />, {
        host: fakeGovernanceHost({ enabledFlags: [SECTION_FLAG, BILLED_COST_FLAG] }),
      });

      expect(screen.getByRole("heading", { name: "Signals & Alerts" })).toBeInTheDocument();
      expect(screen.queryByText("This page is not here")).toBeNull();
    });
  });
});

describe("the Billed address", () => {
  /** @scenario "The unfinished Billed address stays unavailable when Costs is enabled" */
  it("shows the not-found scene even with both flags on", () => {
    renderWithGovernanceHost(<BilledScreen />, {
      host: fakeGovernanceHost({ enabledFlags: [SECTION_FLAG, BILLED_COST_FLAG] }),
    });

    expect(screen.getByText("This page is not here")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Billed" })).toBeNull();
  });
});
