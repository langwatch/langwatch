/**
 * @vitest-environment jsdom
 *
 * Ops dashboard badge: verifies getBadgeCounts procedure answer reaches badge display.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BadgeCounts = { blockedCount: number; dlqCount: number; computedAt: Date | null };

let badgeCounts: { data?: BadgeCounts } = {};
const badgeQueryOptions = vi.fn();

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    ops: {
      getBadgeCounts: {
        useQuery: (_input: undefined, options: unknown) => {
          badgeQueryOptions(options);

          return badgeCounts;
        },
      },
    },
    limits: { getUsage: { useQuery: () => ({}) } },
    user: { getSsoStatus: { useQuery: () => ({}) } },
    featureFlag: { isEnabledForEachOrganization: { useQuery: () => ({}) } },
    personalWorkspaceFeatures: { get: { useQuery: () => ({}) } },
    annotation: { getPendingItemsCount: { useQuery: () => ({}) } },
    governance: {
      resolveHome: { useQuery: () => ({}) },
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

import { WithStubNavigationHost } from "../../../testing.tsx";
import { SidebarContent } from "../product-sidebar.tsx";

const ORGANIZATION = { id: "org_1", name: "Acme", teams: [] };
const PROJECT = { id: "project_1", name: "Demo", slug: "demo", isPersonal: false };

function renderSettingsSidebar({ hasAccess }: { hasAccess: boolean }) {
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        organization: ORGANIZATION,
        organizations: [ORGANIZATION],
        project: PROJECT,
        isLoading: false,
        pathname: "/settings",
        opsAccess: { hasAccess, isAdmin: hasAccess },
      }}
    >
      <SidebarContent surface="settings" showExpanded />
    </WithStubNavigationHost>,
  );
}

/** The badge the entry draws, or null when it draws none. */
function opsBadgeText(): string | null {
  const dashboard = screen.getByRole("link", { name: /Dashboard/ });

  return dashboard.textContent?.replace("Dashboard", "").trim() || null;
}

beforeEach(() => {
  badgeCounts = {};
  badgeQueryOptions.mockClear();
});

afterEach(cleanup);

describe("the operations attention badge", () => {
  describe("given the reader reaches the operations pages", () => {
    /** @scenario The operations Dashboard entry carries the work waiting on it */
    it("renders the blocked groups and dead-lettered jobs the procedure answers", () => {
      badgeCounts = { data: { blockedCount: 4, dlqCount: 3, computedAt: new Date() } };
      renderSettingsSidebar({ hasAccess: true });

      expect(opsBadgeText()).toBe("7");
    });

    /** @scenario An idle fleet leaves the operations entry unmarked */
    it("draws no badge when nothing is waiting", () => {
      badgeCounts = { data: { blockedCount: 0, dlqCount: 0, computedAt: new Date() } };
      renderSettingsSidebar({ hasAccess: true });

      expect(opsBadgeText()).toBeNull();
    });

    it("draws no badge before the first answer arrives", () => {
      renderSettingsSidebar({ hasAccess: true });

      expect(opsBadgeText()).toBeNull();
    });

    it("sets no timer; a read hint will refresh the count", () => {
      renderSettingsSidebar({ hasAccess: true });

      expect(badgeQueryOptions).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
      expect(badgeQueryOptions).not.toHaveBeenCalledWith(
        expect.objectContaining({ refetchInterval: expect.anything() }),
      );
    });
  });

  describe("given the reader does not reach the operations pages", () => {
    /** @scenario A reader without operations access never asks for the counts */
    it("does not ask, because the procedure refuses rather than answers empty", () => {
      renderSettingsSidebar({ hasAccess: false });

      expect(badgeQueryOptions).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
      expect(screen.queryByRole("link", { name: /Dashboard/ })).not.toBeInTheDocument();
    });
  });
});
