// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Costs screen's two gates: the billed-cost flag and `governanceCost:view`.
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 */
import { builtinRolePermissions } from "@langwatch/authz-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";

const harness = vi.hoisted(() => ({ requested: [] as string[] }));

vi.mock("../../../../behavior/governance-api.ts", () => {
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

import CostsScreen from "../governance-costs.screen.tsx";

const ORG_ADMIN = [...builtinRolePermissions("org-admin"), ...builtinRolePermissions("admin")];

function renderCosts({
  permissions = ORG_ADMIN,
  enabledFlags,
}: {
  permissions?: readonly string[];
  enabledFlags?: readonly string[];
}) {
  const host = fakeGovernanceHost({ permissions, ...(enabledFlags ? { enabledFlags } : {}) });
  return renderWithGovernanceHost(<CostsScreen />, { host });
}

beforeEach(() => {
  harness.requested = [];
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe("the Costs screen gates", () => {
  describe("when the billed-cost flag is off", () => {
    /** @scenario "With the billed-cost flag off, Costs does not exist" */
    it("shows the not-found scene and reads nothing", () => {
      renderCosts({ enabledFlags: [] });

      expect(screen.getByText("This page is not here")).toBeInTheDocument();
      expect(harness.requested).toEqual([]);
    });
  });

  describe("when the reader lacks governanceCost:view", () => {
    /** @scenario "A reader without governanceCost:view is told which grant Costs needs" */
    it("names the missing grant and reads nothing", () => {
      renderCosts({ permissions: ["organization:view", "governance:view"] });

      expect(screen.getByText(/governanceCost:view/)).toBeInTheDocument();
      expect(screen.queryByText("This page is not here")).toBeNull();
      expect(harness.requested).toEqual([]);
    });
  });

  describe("when the flag is on and the grant is held", () => {
    it("opens the cost screen and issues its reads", () => {
      renderCosts({
        enabledFlags: [
          "release_ui_ai_governance_enabled",
          "release_ui_governance_billed_cost_enabled",
        ],
      });

      expect(screen.queryByText("This page is not here")).toBeNull();
      expect(harness.requested).toContain("governanceCost.summary");
    });
  });
});
