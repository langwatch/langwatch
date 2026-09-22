/**
 * @vitest-environment jsdom
 *
 * `userIsPartOfTeam` is computed from `team` / `organizationRole`, both of
 * which `useOrganizationTeamProject` withholds while its own organization
 * read is still out (see the hook's `isAwaitingOrganizations` early return).
 * Before this fix, the page never looked at that loading state, so a
 * refusal (`TeamAccessWaiting`) could be drawn from a read that had not
 * answered yet — the same class of half-answered guess the join takeover
 * refuses to make from its own two queries.
 *
 * Spec: specs/identity/identifier-model.feature, "A member is never shown an
 * access refusal before their access has been read".
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { organizationTeamProject, reload } = vi.hoisted(() => ({
  organizationTeamProject: {
    organization: undefined as { id: string; name: string } | undefined,
    team: undefined as
      | { id: string; name: string; isPersonal: boolean }
      | undefined,
    organizationRole: undefined as string | undefined,
    isLoading: true,
  },
  reload: vi.fn(),
}));

beforeEach(() => {
  organizationTeamProject.organization = undefined;
  organizationTeamProject.team = undefined;
  organizationTeamProject.organizationRole = undefined;
  organizationTeamProject.isLoading = true;
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
    organization: organizationTeamProject.organization,
    team: organizationTeamProject.team,
    project: { id: "proj_1" },
    organizationRole: organizationTeamProject.organizationRole,
    hasPermission: () => true,
    isLoading: organizationTeamProject.isLoading,
  }),
  // Membership is deliberately false whenever a team is present in these
  // tests — the case under test is "no team yet" (unanswered) versus
  // "answered, and not on the team" versus "answered, and on the team".
  userBelongsToTeam: (team: { id: string } | undefined, _userId: string) =>
    !!team,
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
      getUsage: { useQuery: () => ({ data: undefined }) },
    },
    user: { getSsoStatus: { useQuery: () => ({ data: undefined }) } },
    checkup: {
      startupNotice: { useQuery: () => ({ data: undefined }) },
    },
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

import { DashboardPageBody } from "../DashboardPageBody";

afterEach(() => cleanup());

function renderDashboard() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DashboardPageBody>
        <p>Private project content</p>
      </DashboardPageBody>
    </ChakraProvider>,
  );
}

describe("given the organization read has not answered yet", () => {
  describe("when the page renders", () => {
    /** @scenario "A member is never shown an access refusal before their access has been read" */
    it("draws no access refusal", () => {
      organizationTeamProject.isLoading = true;
      organizationTeamProject.team = undefined;
      organizationTeamProject.organizationRole = undefined;

      renderDashboard();

      expect(
        screen.queryByRole("heading", { name: "Waiting for team access" }),
      ).toBeNull();
      expect(screen.getByText("Private project content")).toBeInTheDocument();
    });
  });
});

describe("given the organization read has answered", () => {
  describe("when the member is on no team", () => {
    /** @scenario "A member is never shown an access refusal before their access has been read" */
    it("draws the waiting-for-team-access screen", () => {
      organizationTeamProject.isLoading = false;
      organizationTeamProject.organization = { id: "org_1", name: "Acme" };
      organizationTeamProject.team = undefined;
      organizationTeamProject.organizationRole = "MEMBER";

      renderDashboard();

      expect(
        screen.getByRole("heading", { name: "Waiting for team access" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Private project content"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the member is on the team", () => {
    /** @scenario "A member is never shown an access refusal before their access has been read" */
    it("draws the page", () => {
      organizationTeamProject.isLoading = false;
      organizationTeamProject.organization = { id: "org_1", name: "Acme" };
      organizationTeamProject.team = {
        id: "team_1",
        name: "Team",
        isPersonal: false,
      };
      organizationTeamProject.organizationRole = "MEMBER";

      renderDashboard();

      expect(
        screen.queryByRole("heading", { name: "Waiting for team access" }),
      ).toBeNull();
      expect(screen.getByText("Private project content")).toBeInTheDocument();
    });
  });
});
