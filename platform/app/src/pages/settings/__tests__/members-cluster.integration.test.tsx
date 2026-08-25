/**
 * @vitest-environment jsdom
 *
 * The members area as three tabs of one page (D05, D11, D12).
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  members: [] as unknown[],
  invites: [] as unknown[],
  requests: [] as unknown[],
  provenance: {} as Record<string, unknown>,
  provenanceError: null as unknown,
  openDrawer: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_acme", name: "Acme", teams: [] },
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user_ana" } } }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { HAS_EMAIL_PROVIDER_KEY: true } }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: state.openDrawer, closeDrawer: vi.fn() }),
}));

vi.mock("~/hooks/useMemberDisableAction", () => ({
  useMemberDisableAction: () => ({
    setMemberDisabled: vi.fn(),
    isSettingDisabled: false,
  }),
}));

vi.mock("~/hooks/useInviteActions", () => ({
  useInviteActions: () => ({
    resendInvite: vi.fn(),
    revokeInvite: vi.fn(),
    onSubmit: vi.fn(),
    isSubmitting: false,
  }),
}));

// The seat usage and the department column are their own features and are
// covered where they live; here they only have to not get in the way.
vi.mock("~/components/settings/MemberSeatUsage", () => ({
  MemberSeatUsage: () => <div data-testid="seat-usage">Seats</div>,
}));
vi.mock("~/components/settings/useDepartmentColumn", () => ({
  useDepartmentColumn: () => ({
    show: false,
    byUser: new Map(),
    departments: [],
    refetch: vi.fn(),
  }),
}));

vi.mock("~/components/members/useTwoStepRequirement", () => ({
  useTwoStepRequirement: () => ({
    show: false,
    mfaRequired: false,
    byUser: new Map(),
    members: [],
    heldCount: 0,
    connection: { connected: false, assertsSecondFactor: false },
    saving: false,
    setRequirement: vi.fn(),
  }),
}));

vi.mock("~/components/members/useJoinRequests", () => ({
  useJoinRequests: () => ({
    requests: state.requests,
    answeringId: null,
    approve: vi.fn(),
    reject: vi.fn(),
    automaticJoins: [],
    joining: { domainJoin: "off", joinDomains: [] },
    savingJoining: false,
    setJoining: vi.fn(),
  }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard: () => (Component: unknown) => Component,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      organization: {
        getOrganizationWithMembersAndTheirTeams: { invalidate: vi.fn() },
        getMemberById: { invalidate: vi.fn() },
        getAll: { invalidate: vi.fn() },
      },
      limits: { getUsage: { invalidate: vi.fn() } },
      licenseEnforcement: { checkLimit: { invalidate: vi.fn() } },
    }),
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({
          data: { id: "org_acme", members: state.members },
          isError: false,
          error: null,
        }),
      },
      getOrganizationPendingInvites: {
        useQuery: () => ({
          data: state.invites,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      getMemberProvenance: {
        useQuery: () => ({
          data: state.provenanceError ? undefined : state.provenance,
          isError: !!state.provenanceError,
          error: state.provenanceError,
        }),
      },
      deleteMember: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    plan: {
      getActivePlan: {
        useQuery: () => ({ data: { free: false, type: "ENTERPRISE" } }),
      },
    },
  },
}));

const Members = (await import("../members")).default;

function renderMembers() {
  return render(
    // Inside a matched route, not bare under the router: which tab is open is
    // a search parameter, and the setter navigates relative to the route it
    // is called from. A component with no route to be relative to keeps the
    // address it started with, and every tab silently stops switching.
    <MemoryRouter initialEntries={["/settings/members"]}>
      <ChakraProvider value={defaultSystem}>
        <Routes>
          <Route path="/settings/members" element={<Members />} />
        </Routes>
      </ChakraProvider>
    </MemoryRouter>,
  );
}

/**
 * Open a tab and wait for it to actually be open.
 *
 * The tab state settles a tick after the click — the machine behind the tabs
 * is asynchronous — so asserting straight after it reads the tab the reader
 * came from. This throws rather than asserting, so a switch that never
 * happened names itself instead of surfacing as a puzzling missing element
 * three lines later.
 */
async function selectTab(name: RegExp) {
  await userEvent.click(screen.getByRole("tab", { name }));
  await waitFor(() => {
    const selected = screen
      .getByRole("tab", { name })
      .getAttribute("aria-selected");
    if (selected !== "true") {
      throw new Error(
        `The ${name} tab is aria-selected="${selected}" after the click, so it never opened.`,
      );
    }
  });
}

const sam = {
  userId: "user_sam",
  role: "MEMBER",
  disabledAt: null,
  user: {
    id: "user_sam",
    name: "Sam Rivera",
    email: "sam@acme.com",
    image: null,
    deactivatedAt: null,
  },
};

const ana = {
  userId: "user_ana",
  role: "ADMIN",
  disabledAt: null,
  user: {
    id: "user_ana",
    name: "Ana Diaz",
    email: "ana@acme.com",
    image: null,
    deactivatedAt: null,
  },
};

describe("given an organization's members page", () => {
  beforeEach(() => {
    state.members = [sam, ana];
    state.invites = [];
    state.requests = [];
    state.provenance = {};
    state.provenanceError = null;
    state.openDrawer.mockClear();
  });
  afterEach(() => cleanup());

  describe("when an administrator opens it", () => {
    /** @scenario The members page opens on the people who are here */
    it("shows three tabs and opens on the members", () => {
      renderMembers();

      // Each tab now carries its count in a badge, so the accessible name is
      // the label and the number together.
      expect(screen.getByRole("tab", { name: /^Members/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("tab", { name: /Invitations/ })).toBeTruthy();
      expect(screen.getByRole("tab", { name: /Join requests/ })).toBeTruthy();
      expect(screen.getByTestId("members-list")).toBeInTheDocument();
      expect(screen.getByTestId("seat-usage")).toBeInTheDocument();
    });

    /** @scenario The rules about people are not on the page about people */
    it("carries neither the second-factor requirement nor the joining policy", () => {
      renderMembers();

      expect(screen.queryByTestId("two-step-requirement-card")).toBeNull();
      expect(screen.queryByTestId("join-policy-card")).toBeNull();
    });

    /** @scenario One identity row carries a person wherever they appear */
    it("gives every person the same row of name and address", () => {
      renderMembers();

      const rows = screen.getAllByTestId("member-row");
      expect(rows).toHaveLength(2);
      expect(within(rows[0]!).getByText("Ana Diaz")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("ana@acme.com")).toBeInTheDocument();
    });

    /** @scenario Opening a person puts them in the address bar */
    it("opens the person drawer with the person's id", async () => {
      renderMembers();

      await userEvent.click(screen.getByLabelText("Open Sam Rivera"));

      expect(state.openDrawer).toHaveBeenCalledWith("person", {
        userId: "user_sam",
      });
    });
  });

  describe("when somebody is waiting", () => {
    beforeEach(() => {
      state.invites = [
        {
          id: "inv_1",
          email: "dana@acme.com",
          role: "MEMBER",
          displayStatus: "PENDING",
          expiration: new Date("2026-09-03T09:00:00Z"),
          inviteCode: "code_1",
          teamIds: "",
        },
        {
          id: "inv_2",
          email: "eve@acme.com",
          role: "MEMBER",
          displayStatus: "EXPIRED",
          expiration: new Date("2026-08-03T09:00:00Z"),
          inviteCode: "code_2",
          teamIds: "",
        },
        {
          id: "inv_3",
          email: "old@acme.com",
          role: "MEMBER",
          displayStatus: "ACCEPTED",
          expiration: null,
          inviteCode: "code_3",
          teamIds: "",
        },
      ];
      state.requests = [
        {
          joinRequestId: "jreq_1",
          name: "Rex Ford",
          domain: "acme.com",
          requestedAt: new Date("2026-08-20T09:00:00Z"),
          expiresAt: null,
        },
      ];
    });

    /** @scenario A tab that is waiting on somebody says how many */
    it("counts only what is still waiting on the tab", () => {
      renderMembers();

      // The accepted invitation is history, not a thing anybody is waiting on.
      // The count rides in a badge beside the label rather than in the label,
      // so it reads as "Invitations 2" to an assistive reader.
      expect(
        screen.getByRole("tab", { name: "Invitations 2" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: "Join requests 1" }),
      ).toBeInTheDocument();
    });

    /** @scenario One identity row carries a person wherever they appear */
    it("uses the same row for an invitation and for a request", async () => {
      renderMembers();

      await selectTab(/Invitations/);
      const invite = screen.getAllByTestId("invite-row")[0]!;
      expect(within(invite).getByText("dana@acme.com")).toBeInTheDocument();
      expect(within(invite).getByTestId("invite-status").textContent).toBe(
        "Invited",
      );

      await selectTab(/Join requests/);
      const request = screen.getByTestId("join-request-row");
      expect(within(request).getByText("Rex Ford")).toBeInTheDocument();
      expect(within(request).getByText("acme.com")).toBeInTheDocument();
    });
  });

  describe("when nothing is waiting", () => {
    /** @scenario An empty tab says it is empty */
    it("says the tab is empty rather than showing a blank panel", async () => {
      renderMembers();

      await selectTab(/Join requests/);

      expect(screen.getByTestId("join-requests-list").textContent).toContain(
        "Nobody is waiting to join",
      );
    });
  });

  describe("when the directory created somebody", () => {
    beforeEach(() => {
      state.provenance = {
        user_sam: { source: "directory", providerId: "okta" },
      };
    });

    /** @scenario A member the directory owns says so */
    it("marks them as the directory's", () => {
      renderMembers();

      expect(screen.getByTestId("provenance-directory")).toBeInTheDocument();
    });
  });

  describe("when somebody walked in on the domain policy", () => {
    beforeEach(() => {
      state.provenance = {
        user_sam: { source: "domain", domain: "acme.com", automatic: true },
      };
    });

    /** @scenario A member who walked in on the domain policy says nobody approved */
    it("names the domain and says nobody approved it", () => {
      renderMembers();

      const chip = screen.getByTestId("provenance-domain");
      expect(chip).toBeInTheDocument();
      expect(chip.getAttribute("title")).toContain("acme.com");
      expect(chip.getAttribute("title")).toContain("Nobody approved this");
    });
  });

  describe("when nothing explains how somebody got here", () => {
    beforeEach(() => {
      state.provenance = { user_ana: { source: "unknown" } };
    });

    /** @scenario A member we cannot explain carries no chip rather than a guess */
    it("shows no chip at all", () => {
      renderMembers();

      expect(screen.queryByTestId("provenance-invited")).toBeNull();
      expect(screen.queryByTestId("provenance-domain")).toBeNull();
      expect(screen.queryByTestId("provenance-directory")).toBeNull();
    });
  });

  describe("when the reasons cannot be worked out", () => {
    beforeEach(() => {
      state.provenanceError = new Error("boom");
    });

    /** @scenario The reason somebody is here is asked for separately */
    it("still lists everybody, and degrades only the chips", () => {
      renderMembers();

      expect(screen.getAllByTestId("member-row")).toHaveLength(2);
      expect(screen.getByTestId("section-error-notice")).toBeInTheDocument();
      expect(screen.queryByTestId("provenance-directory")).toBeNull();
    });
  });
});
