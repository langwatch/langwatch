/**
 * @vitest-environment jsdom
 * Plan-limit banners: positioned layers outside box. Message-limit readable.
 */

import { Box } from "@langwatch/design-system/primitives";
import { system } from "@langwatch/design-system/system";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { ShellPageBody as DashboardPageBody } from "../shell-page-body.tsx";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: "/[project]", query: { project: "acme" } }),
}));

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    limits: {
      getUsage: {
        useQuery: () => ({
          data: {
            currentMonthCost: 0,
            maxMonthlyUsageLimit: 100,
            messageLimitInfo: {
              status: "exceeded",
              message: "You reached the limit of 1,000 messages this month.",
            },
          },
        }),
      },
    },
    user: { getSsoStatus: { useQuery: () => ({ data: undefined }) } },
    governance: {
      recordWorkspaceView: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

afterEach(() => cleanup());

/**
 * jsdom does not resolve custom properties, so a token-valued `zIndex`
 * computes to its `var(--chakra-z-index-*)` reference. Resolve it through
 * the same system that emitted it.
 */
function resolveZIndex(raw: string): number {
  const token = /^var\(--chakra-z-index-([\w-]+)\)$/.exec(raw)?.[1];
  return Number(token ? system.token(`zIndex.${token}`) : raw);
}

/** What the home page does: a positioned container that stacks above static siblings. */
function PageWithPositionedLayer() {
  return (
    <Box position="relative" zIndex={1} data-testid="page-layer">
      page content
    </Box>
  );
}

describe("given a project whose message limit is exceeded", () => {
  describe("when the page paints a positioned layer of its own", () => {
    it("stacks the banner above the page's own layer", () => {
      renderWithDesignSystem(
        <WithStubNavigationHost
          readings={{
            pathname: "/acme",
            currentUserId: "user_1",
            organization: { id: "org_1", name: "Organization", teams: [] },
            team: {
              id: "team_1",
              name: "Team",
              isPersonal: false,
              members: [{ userId: "user_1" }],
              projects: [],
            },
            project: { id: "proj_1", name: "Project", slug: "acme" },
            organizationRole: "MEMBER",
            deployment: { isSaaS: true },
            permissions: ["organization:view"],
          }}
        >
          <DashboardPageBody>
            <PageWithPositionedLayer />
          </DashboardPageBody>
        </WithStubNavigationHost>,
      );

      const alert = screen.getByText(/You reached the limit/);
      const banners = alert.closest<HTMLElement>("[data-part='page-banners']");
      expect(banners).not.toBeNull();

      const bannerStyle = getComputedStyle(banners!);
      const pageStyle = getComputedStyle(screen.getByTestId("page-layer"));
      expect(bannerStyle.position).not.toBe("static");
      expect(resolveZIndex(bannerStyle.zIndex)).toBeGreaterThan(resolveZIndex(pageStyle.zIndex));
    });
  });
});
