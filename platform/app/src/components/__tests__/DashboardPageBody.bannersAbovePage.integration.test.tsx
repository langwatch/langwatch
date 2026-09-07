/**
 * @vitest-environment jsdom
 *
 * The plan-limit banners are chrome. A page that paints positioned layers
 * outside its own box (the home hero's light-mode bloom bleeds upward by
 * almost half its height) used to wash the "You reached the limit" alert
 * out to a faint smear, because the alert was a static box and the page's
 * container was a positioned `zIndex` layer above it. Customer report: the
 * message-limit banner was unreadable on the home page.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  SavedViewsProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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

vi.mock("../../utils/tracking", () => ({ trackEvent: vi.fn() }));
vi.mock("../AnnouncementBanner", () => ({ AnnouncementBanner: () => null }));
vi.mock("../CurrentDrawer", () => ({ CurrentDrawer: () => null }));
vi.mock("../UpgradeModal", () => ({ GlobalUpgradeModal: () => null }));
vi.mock("../SavedViewsBar", () => ({ SavedViewsBar: () => null }));
vi.mock("../../features/traces-v2/components/GlobalTraceV2DrawerMount", () => ({
  GlobalTraceV2DrawerMount: () => null,
}));

import { Box } from "@chakra-ui/react";
import { DashboardPageBody } from "../DashboardPageBody";

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

describe("DashboardPageBody banners", () => {
  describe("when the message limit is exceeded and the page paints a positioned layer", () => {
    /** @scenario The plan-limit banner stays above page content that bleeds over it */
    it("stacks the banner above the page's own layer", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <DashboardPageBody>
            <PageWithPositionedLayer />
          </DashboardPageBody>
        </ChakraProvider>,
      );

      const alert = screen.getByText(/You reached the limit/);
      const banners = alert.closest("[data-part='page-banners']");
      expect(banners).not.toBeNull();

      const bannerStyle = getComputedStyle(banners!);
      const pageStyle = getComputedStyle(screen.getByTestId("page-layer"));
      expect(bannerStyle.position).not.toBe("static");
      expect(resolveZIndex(bannerStyle.zIndex)).toBeGreaterThan(
        resolveZIndex(pageStyle.zIndex),
      );
    });
  });
});
