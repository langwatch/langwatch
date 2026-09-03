/**
 * @vitest-environment jsdom
 *
 * The number on the operations Dashboard entry.
 *
 * `ops.getBadgeCounts` was served and called by nobody once the legacy chrome's
 * `OpsSection` went: the procedure answered, and the menu drew nothing. This
 * suite mounts the settings sidebar the reader actually sees and asserts the
 * badge carries what the procedure answers, so the two halves cannot come apart
 * again without a red test.
 *
 * Spec: specs/navigation/ops-navigation-v2.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BadgeCounts = { blockedCount: number; dlqCount: number; computedAt: Date | null };

let badgeCounts: { data?: BadgeCounts } = {};
const badgeQueryOptions = vi.fn();

vi.mock("../../../behavior/navigation-api", () => ({
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

import { WithStubNavigationHost } from "../../../testing";
import { SidebarContent } from "../product-sidebar";

const ORGANIZATION = { id: "org_1", name: "Acme", teams: [] };
const PROJECT = { id: "project_1", name: "Demo", slug: "demo", isPersonal: false };

function renderSettingsSidebar({ hasAccess }: { hasAccess: boolean }) {
  return render(
    <ChakraProvider value={defaultSystem}>
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
      </WithStubNavigationHost>
    </ChakraProvider>,
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

    it("keeps re-asking, because the count is about work arriving rather than a page load", () => {
      renderSettingsSidebar({ hasAccess: true });

      expect(badgeQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, refetchInterval: 60_000 }),
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
