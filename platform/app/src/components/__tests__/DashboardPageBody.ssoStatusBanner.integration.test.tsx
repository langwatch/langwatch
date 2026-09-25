/**
 * @vitest-environment jsdom
 *
 * `getSsoStatus` can report `pendingSsoSetup: true` for a member stuck with a
 * stale flag: `Organization` requires single sign-on, and this member has
 * not yet re-signed-in through it. There is nothing to click in
 * `/settings/security` for that member (an SSO-enforced organization offers
 * no connectable providers there), so the banner must not send them there.
 * See specs/auth/sso-wrong-provider-recovery.feature.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ssoStatus } = vi.hoisted(() => ({
  ssoStatus: { data: undefined as { pendingSsoSetup: boolean } | undefined },
}));

beforeEach(() => {
  ssoStatus.data = undefined;
});

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    pathname: "/[project]",
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
      getUsage: { useQuery: () => ({ data: undefined }) },
    },
    user: {
      getSsoStatus: { useQuery: () => ssoStatus },
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

import { signOut } from "~/utils/auth-client";
import { DashboardPageBody } from "../DashboardPageBody";

afterEach(() => cleanup());

function renderDashboard() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DashboardPageBody>
        <p>Project content</p>
      </DashboardPageBody>
    </ChakraProvider>,
  );
}

describe("given the member still needs to switch to single sign-on", () => {
  beforeEach(() => {
    ssoStatus.data = { pendingSsoSetup: true };
  });

  /** @scenario A member still on the wrong sign-in is told to sign out and use their work email */
  it("tells them to sign out and offers a sign-out action, with no link to settings", () => {
    const { container } = renderDashboard();

    expect(
      screen.getByText("Sign in with your organization's single sign-on"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Sign out, then sign in again by entering your work/),
    ).toBeInTheDocument();
    expect(container.querySelector('a[href="/settings/security"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalled();
  });
});

describe("given the member already satisfies single sign-on", () => {
  beforeEach(() => {
    ssoStatus.data = { pendingSsoSetup: false };
  });

  /** @scenario A member who already signs in through single sign-on is not asked to link again */
  it("renders no banner", () => {
    renderDashboard();

    expect(
      screen.queryByText("Sign in with your organization's single sign-on"),
    ).toBeNull();
  });
});
