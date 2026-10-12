/**
 * @vitest-environment jsdom
 *
 * Every analytics path mounts the saved-views bar at the foot of the page.
 * On an aggregate project (ADR-144) the analytics pages only say they are not
 * available yet, and the project takes no writes, so the bar's Edit menu
 * would offer renames and deletes the server refuses. The bar, and its
 * provider with the saved-views read it owns, follow the same navigation rule
 * the analytics gate does.
 *
 * @see specs/governance/aggregate-project.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { projectRef, savedViewsRead } = vi.hoisted(() => ({
  projectRef: {
    current: { id: "proj_1", slug: "acme", kind: "application" },
  },
  savedViewsRead: vi.fn(),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/[project]/analytics",
    query: { project: "acme" },
    reload: vi.fn(),
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
    project: projectRef.current,
    organizationRole: "MEMBER",
    hasPermission: () => true,
    isLoading: false,
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

// The provider owns the one saved-views read on this page, so it records
// that it mounted: if it never does, no saved views are read.
vi.mock("../../hooks/useSavedViews", () => ({
  SavedViewsProvider: ({ children }: { children: React.ReactNode }) => {
    savedViewsRead();
    return <>{children}</>;
  },
}));

vi.mock("../../utils/api", () => ({
  api: {
    limits: {
      getUsage: { useQuery: () => ({ data: undefined }) },
    },
    user: { getSsoStatus: { useQuery: () => ({ data: undefined }) } },
    twoStepVerification: {
      standing: { useQuery: () => ({ data: undefined, refetch: vi.fn() }) },
    },
    governance: {
      recordWorkspaceView: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
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

vi.mock("../../utils/tracking", () => ({ trackEvent: vi.fn() }));
vi.mock("../AnnouncementBanner", () => ({ AnnouncementBanner: () => null }));
vi.mock("../CurrentDrawer", () => ({ CurrentDrawer: () => null }));
vi.mock("../UpgradeModal", () => ({ GlobalUpgradeModal: () => null }));
vi.mock("../SavedViewsBar", () => ({
  SavedViewsBar: () => (
    <div data-testid="saved-views-bar">
      <button type="button">Edit</button>
    </div>
  ),
}));
vi.mock("../../features/traces-v2/components/GlobalTraceV2DrawerMount", () => ({
  GlobalTraceV2DrawerMount: () => null,
}));

import { DashboardPageBody } from "../DashboardPageBody";

beforeEach(() => {
  savedViewsRead.mockClear();
});

afterEach(() => cleanup());

function renderAnalyticsPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DashboardPageBody>
        <p>Analytics page</p>
      </DashboardPageBody>
    </ChakraProvider>,
  );
}

describe("DashboardPageBody on an analytics path", () => {
  describe("given an aggregate project", () => {
    describe("when the analytics page renders", () => {
      /** @scenario "A direct link to the aggregate's analytics says it is not available yet" */
      it("shows no saved-views bar, no Edit, and reads no saved views", () => {
        projectRef.current = { id: "agg_1", slug: "agg", kind: "aggregate" };

        renderAnalyticsPage();

        expect(screen.getByText("Analytics page")).toBeInTheDocument();
        expect(screen.queryByTestId("saved-views-bar")).toBeNull();
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
        expect(savedViewsRead).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an ordinary project", () => {
    describe("when the analytics page renders", () => {
      /** @scenario "A direct link to the aggregate's analytics says it is not available yet" */
      it("still shows the saved-views bar", () => {
        projectRef.current = {
          id: "proj_1",
          slug: "acme",
          kind: "application",
        };

        renderAnalyticsPage();

        expect(screen.getByTestId("saved-views-bar")).toBeInTheDocument();
        expect(savedViewsRead).toHaveBeenCalled();
      });
    });
  });
});
