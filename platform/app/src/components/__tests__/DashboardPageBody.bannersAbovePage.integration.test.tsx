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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { membership, reload } = vi.hoisted(() => ({
  membership: { allowed: true },
  reload: vi.fn(),
}));

beforeEach(() => {
  membership.allowed = true;
  reload.mockClear();
});

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/[project]",
    query: { project: "acme" },
    reload,
  }),
}));

vi.mock("../../hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { id: "user_1" } },
    status: "authenticated",
  }),
}));

vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_1", name: "Acme" },
    team: { id: "team_1", name: "Team", isPersonal: false },
    project: { id: "proj_1" },
    organizationRole: "MEMBER",
    hasPermission: () => true,
  }),
  userBelongsToTeam: () => membership.allowed,
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
    // The page's MFA gate reads this on every render (useOrganizationMfaGate).
    // `data: undefined` is the honest stand-in for the query the gate does not
    // run here: MFA_ENROLLMENT_OPEN is not set in this test's public env, so
    // the real hook passes `enabled: false` and never fetches.
    twoStepVerification: {
      standing: {
        useQuery: () => ({ data: undefined, refetch: vi.fn() }),
      },
    },
    governance: {
      recordWorkspaceView: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    // The page renders JoinYourTeamTakeover, which asks these before it shows
    // anything. `isPending: true` is what this test wants: the takeover
    // returns null until BOTH answers are in, so the page under test paints
    // its own layers and nothing else.
    joinRequests: {
      offer: { useQuery: () => ({ isPending: true, data: undefined }) },
      mine: { useQuery: () => ({ isPending: true, data: undefined }) },
      dismissOffer: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      request: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({}),
  },
}));

vi.mock("~/utils/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/auth-client")>()),
  signOut: vi.fn(),
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
import { signOut } from "~/utils/auth-client";
import { DashboardPageBody } from "../DashboardPageBody";

afterEach(() => cleanup());

/** @scenario "A member without team access sees what they are waiting for" */
it("holds project content until team access is available and offers a fresh check", () => {
  membership.allowed = false;
  const view = render(
    <ChakraProvider value={defaultSystem}>
      <DashboardPageBody>
        <p>Private project content</p>
      </DashboardPageBody>
    </ChakraProvider>,
  );

  expect(
    screen.getByRole("heading", { name: "Waiting for team access" }),
  ).toBeInTheDocument();
  expect(screen.getByText("You’re signed in to Acme.")).toBeInTheDocument();
  const waitingScreen = screen.getByRole("dialog", {
    name: "Waiting for team access",
  });
  expect(waitingScreen).toHaveAttribute("aria-modal", "true");
  expect(getComputedStyle(waitingScreen).minHeight).toBe("100dvh");
  expect(screen.queryByText("Private project content")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check access" }));
  expect(reload).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute(
    "href",
    "/",
  );

  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(signOut).toHaveBeenCalled();

  membership.allowed = true;
  view.rerender(
    <ChakraProvider value={defaultSystem}>
      <DashboardPageBody>
        <p>Private project content</p>
      </DashboardPageBody>
    </ChakraProvider>,
  );
  expect(
    screen.queryByRole("heading", { name: "Waiting for team access" }),
  ).toBeNull();
  expect(screen.getByText("Private project content")).toBeInTheDocument();
});

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
