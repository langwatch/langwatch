/**
 * @vitest-environment jsdom
 * The broadcast preference belongs to the account dropdown, not to the
 * left navigation, including on the one surface where presence is live
 * (presence-toggle-placement.feature).
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    annotation: { getPendingItemsCount: { useQuery: () => ({}) } },
    personalWorkspaceFeatures: { get: { useQuery: () => ({}) } },
    limits: { getUsage: { useQuery: () => ({}) } },
    ops: { getBadgeCounts: { useQuery: () => ({}) } },
    governance: {
      resolveHome: { useQuery: () => ({}) },
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    user: { getSsoStatus: { useQuery: () => ({}) } },
    featureFlag: { isEnabledForEachOrganization: { useQuery: () => ({}) } },
  },
}));

import { WithStubNavigationHost } from "../../../testing.tsx";
import { ProductSidebar } from "../product-sidebar.tsx";

const project = { id: "project_1", slug: "demo", name: "Demo", isPersonal: false };
const team = {
  id: "team_1",
  name: "Core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1" }],
  projects: [project],
};
const organization = { id: "org_1", name: "ACME", teams: [team] };

function renderSidebarOnTraces() {
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        pathname: "/demo/traces",
        organizations: [organization],
        organization,
        team,
        project,
        currentUser: { id: "user_1", name: "Ada", email: "ada@example.com", image: null },
      }}
    >
      <ProductSidebar surface="llm-ops" isCompact={false} />
    </WithStubNavigationHost>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("the left navigation on the traces lens", () => {
  describe("when the sidebar renders", () => {
    /** @scenario Main left navigation no longer renders the presence toggle */
    it("carries no presence toggle, in its entries or in its bottom rail", () => {
      renderSidebarOnTraces();

      const sidebar = screen.getByTestId("product-sidebar");
      expect(within(sidebar).queryByText(/presence/i)).toBeNull();

      const bottomRail = within(sidebar).getByTestId("sidebar-bottom-block");
      expect(bottomRail.textContent ?? "").not.toMatch(/presence/i);
    });
  });
});
