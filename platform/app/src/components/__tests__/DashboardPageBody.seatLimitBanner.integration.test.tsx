/**
 * @vitest-environment jsdom
 *
 * An organization whose plan shrank under it (cancelled subscription, removed
 * override, backoffice edit back to Free) keeps its members and ends up using
 * more seats than the plan includes. Every page tells it so and links to the
 * subscription page, instead of waiting for the next invite to be refused.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SeatLimitStatus = "ok" | "exceeded";

const { membership, reload, usage, trackEvent } = vi.hoisted(() => ({
  membership: { allowed: true },
  reload: vi.fn(),
  usage: {
    data: undefined as
      | {
          currentMonthCost: number;
          maxMonthlyUsageLimit: number;
          messageLimitInfo: { status: "ok"; message: string };
          seatLimitInfo: { status: SeatLimitStatus; message: string };
        }
      | undefined,
  },
  trackEvent: vi.fn(),
}));

const givenSeatLimit = ({
  status,
  message,
}: {
  status: SeatLimitStatus;
  message: string;
}) => {
  usage.data = {
    currentMonthCost: 0,
    maxMonthlyUsageLimit: 100,
    messageLimitInfo: { status: "ok", message: "" },
    seatLimitInfo: { status, message },
  };
};

beforeEach(() => {
  membership.allowed = true;
  reload.mockClear();
  trackEvent.mockClear();
  usage.data = undefined;
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
        useQuery: () => ({ data: usage.data }),
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
      admitAutomatically: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    invite: {
      pendingForMe: { useQuery: () => ({ isPending: true, data: undefined }) },
      acceptInvite: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    useUtils: () => ({}),
  },
}));

vi.mock("~/utils/auth-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/auth-client")>()),
  signOut: vi.fn(),
}));

vi.mock("../../utils/tracking", () => ({ trackEvent }));
vi.mock("../AnnouncementBanner", () => ({ AnnouncementBanner: () => null }));
vi.mock("../CurrentDrawer", () => ({ CurrentDrawer: () => null }));
vi.mock("../UpgradeModal", () => ({ GlobalUpgradeModal: () => null }));
vi.mock("../SavedViewsBar", () => ({ SavedViewsBar: () => null }));
vi.mock("../../features/traces-v2/components/GlobalTraceV2DrawerMount", () => ({
  GlobalTraceV2DrawerMount: () => null,
}));

import { DashboardPageBody } from "../DashboardPageBody";

afterEach(() => cleanup());

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <DashboardPageBody>
        <p>Page content</p>
      </DashboardPageBody>
    </ChakraProvider>,
  );

describe("<DashboardPageBody/> seat limit banner", () => {
  describe("when the organization uses more seats than its plan includes", () => {
    /** @scenario "Every page shows the upgrade banner while the seat limit is exceeded" */
    it("shows the seat counts and links to the subscription page", () => {
      givenSeatLimit({
        status: "exceeded",
        message:
          "Your organization uses 3 member seats and your plan includes 2 member seats.",
      });

      renderPage();

      const banner = screen.getByTestId("seat-limit-banner");
      expect(banner).toHaveTextContent(
        "Your organization uses 3 member seats and your plan includes 2 member seats. Upgrade your plan to keep everyone.",
      );
      const link = screen.getByRole("link", { name: "Upgrade your plan" });
      expect(link).toHaveAttribute("href", "/settings/subscription");
      expect(screen.getByText("Page content")).toBeInTheDocument();
    });

    it("tracks the click as a seats limit subscription hook", () => {
      givenSeatLimit({ status: "exceeded", message: "Over the limit." });

      renderPage();
      fireEvent.click(screen.getByRole("link", { name: "Upgrade your plan" }));

      expect(trackEvent).toHaveBeenCalledWith("subscription_hook_click", {
        project_id: "proj_1",
        hook: "seats_limit_exceeded",
      });
    });
  });

  describe("when the organization is within its plan's seats", () => {
    /** @scenario "The upgrade banner is not shown while seats are within the plan" */
    it("does not show the seat limit banner", () => {
      givenSeatLimit({ status: "ok", message: "" });

      renderPage();

      expect(screen.queryByTestId("seat-limit-banner")).toBeNull();
    });
  });
});
