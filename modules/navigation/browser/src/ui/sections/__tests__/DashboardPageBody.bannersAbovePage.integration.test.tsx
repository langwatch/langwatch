/**
 * @vitest-environment jsdom
 * Plan-limit banners: positioned layers outside box. Message-limit readable.
 */

import { ChakraProvider, defaultSystem, Box } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { ShellPageBody as DashboardPageBody } from "../shell-page-body.tsx";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: "/[project]", query: { project: "acme" } }),
}));

vi.mock("../../hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { id: "user_1" } },
    status: "authenticated",
  }),
}));

vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_1" },
    team: { id: "team_1", name: "Team", isPersonal: false },
    project: { id: "proj_1" },
    organizationRole: "MEMBER",
    hasPermission: () => true,
  }),
  userBelongsToTeam: () => true,
}));

vi.mock("../../hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({
    data: {
      NODE_ENV: "test",
      HAS_LANGWATCH_NLP_SERVICE: true,
      HAS_LANGEVALS_ENDPOINT: true,
    },
  }),
}));

vi.mock("../../hooks/usePlanManagementUrl", () => ({
  usePlanManagementUrl: () => ({ url: "/settings/subscription" }),
}));

vi.mock("../../hooks/useSavedViews", () => ({
  SavedViewsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../utils/api", () => ({
  api: {
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

vi.mock("../../utils/tracking", () => ({ trackEvent: vi.fn() }));
vi.mock("../AnnouncementBanner", () => ({ AnnouncementBanner: () => null }));
vi.mock("../CurrentDrawer", () => ({ CurrentDrawer: () => null }));
vi.mock("../UpgradeModal", () => ({ GlobalUpgradeModal: () => null }));
vi.mock("../SavedViewsBar", () => ({ SavedViewsBar: () => null }));
vi.mock("../../features/traces-v2/components/GlobalTraceV2DrawerMount", () => ({
  GlobalTraceV2DrawerMount: () => null,
}));

afterEach(() => cleanup());

/**
 * jsdom does not resolve custom properties, so a token-valued `zIndex`
 * computes to its `var(--chakra-z-index-*)` reference. Resolve it through
 * the same system that emitted it.
 */
function resolveZIndex(raw: string): number {
  const token = /^var\(--chakra-z-index-([\w-]+)\)$/.exec(raw)?.[1];
  return Number(token ? defaultSystem.token(`zIndex.${token}`) : raw);
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
      render(
        <ChakraProvider value={defaultSystem}>
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
          </WithStubNavigationHost>
        </ChakraProvider>,
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
