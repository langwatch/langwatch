/**
 * @vitest-environment jsdom
 *
 * Binds the spend-view scenarios from specs/governance/governance-navigation.feature:
 * with `release_ui_governance_billed_cost_enabled` off, no sidebar item and
 * a deep link reads as a missing page; with it on, the items appear and
 * each address renders its placeholder.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BilledPage from "~/pages/governance/billed";
// Imported at the top: vitest hoists the vi.mock / vi.hoisted calls below
// above these statements, so the modules under test still resolve the mocks.
import CostsPage from "~/pages/governance/costs";

import { useGovernanceNavItems } from "../useGovernanceNavItems";

const { spendEnabled } = vi.hoisted(() => ({
  spendEnabled: { current: false },
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({
    enabled: spendEnabled.current,
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_test" },
    isLoading: false,
    hasAnyPermission: () => true,
  }),
}));

// The layout pulls in the whole section-navigation chrome; the placeholder
// body is what these scenarios are about.
vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const MISSING_PAGE_TEXT = "This page doesn't exist or has been moved.";

function renderWithChakra(node: ReactNode) {
  return render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);
}

describe("given the governance spend views sit behind their switch", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    spendEnabled.current = false;
  });

  describe("when the switch is off", () => {
    // @scenario "The spend views stay hidden until their switch is on"
    it("keeps no Costs or Billed item in the navigation list", () => {
      const { result } = renderHookResult();

      const labels = result.map((item) => item.label);
      expect(labels).not.toContain("Costs");
      expect(labels).not.toContain("Billed");
    });

    // @scenario "The spend views stay hidden until their switch is on"
    it("reads each spend address as a missing page", () => {
      renderWithChakra(<CostsPage />);
      expect(screen.getByText(MISSING_PAGE_TEXT)).toBeDefined();

      cleanup();
      renderWithChakra(<BilledPage />);
      expect(screen.getByText(MISSING_PAGE_TEXT)).toBeDefined();
    });
  });

  describe("when the switch is on", () => {
    // @scenario "A switched-on organization sees and reaches the spend pages"
    it("lists Costs and Billed between Overview and Inventory", () => {
      spendEnabled.current = true;
      const { result } = renderHookResult();

      const labels = result.map((item) => item.label);
      expect(labels.indexOf("Costs")).toBeGreaterThan(
        labels.indexOf("Overview"),
      );
      expect(labels.indexOf("Costs")).toBeLessThan(labels.indexOf("Inventory"));
      expect(labels).toContain("Billed");
    });

    // @scenario "A switched-on organization sees and reaches the spend pages"
    it("renders each address as its placeholder page instead of a missing page", () => {
      spendEnabled.current = true;

      renderWithChakra(<CostsPage />);
      expect(screen.getByText(/Cost data for this organization/)).toBeDefined();
      expect(screen.queryByText(MISSING_PAGE_TEXT)).toBeNull();

      cleanup();
      renderWithChakra(<BilledPage />);
      expect(
        screen.getByText(/Billing records for this organization/),
      ).toBeDefined();
      expect(screen.queryByText(MISSING_PAGE_TEXT)).toBeNull();
    });
  });
});

/** Runs the navigation hook and returns its current item list. */
function renderHookResult() {
  let result: ReturnType<typeof useGovernanceNavItems>;
  function Probe() {
    result = useGovernanceNavItems();
    return null;
  }
  renderWithChakra(<Probe />);
  return { result: result! };
}
