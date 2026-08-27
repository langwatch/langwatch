/**
 * @vitest-environment jsdom
 *
 * Everybody in the organization as three cuts of one list, on the Directory's
 * people tab (D05, D11, D12).
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
  /** What the department column reports, so a member can belong somewhere. */
  departments: {
    show: false,
    departments: [] as { id: string; name: string }[],
    byUser: new Map<string, string>(),
  },
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
    show: state.departments.show,
    byUser: state.departments.byUser,
    byTeam: new Map(),
    byProject: new Map(),
    departments: state.departments.departments,
    refetch: vi.fn(),
  }),
}));
// The picker owns the assign mutations, which the api double does not carry;
// the editing control is covered where it lives. Here only the read matters.
vi.mock("~/components/settings/DepartmentPicker", () => ({
  DepartmentPicker: () => <div data-testid="department-picker" />,
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

const { PeopleSection } = await import("../PeopleSection");

function renderPeople() {
  return render(
    // Inside a matched route, not bare under the router: which cut is open is
    // a search parameter, and the setter navigates relative to the route it
    // is called from. A component with no route to be relative to keeps the
    // address it started with, and every chip silently stops switching.
    <MemoryRouter initialEntries={["/settings/directory"]}>
      <ChakraProvider value={defaultSystem}>
        <Routes>
          <Route
            path="/settings/directory"
            element={<PeopleSection organizationId="org_acme" />}
          />
        </Routes>
      </ChakraProvider>
    </MemoryRouter>,
  );
}

/** A cut chip, by the accessible name FilterChips builds from label and count. */
const cut = (name: RegExp) => screen.getByRole("button", { name });

/**
 * Select a cut and wait for it to actually be selected.
 *
 * This throws rather than asserting, so a switch that never happened names
 * itself instead of surfacing as a puzzling missing element three lines later.
 */
async function selectCut(name: RegExp) {
  await userEvent.click(cut(name));
  await waitFor(() => {
    const pressed = cut(name).getAttribute("aria-pressed");
    if (pressed !== "true") {
      throw new Error(
        `The ${name} cut is aria-pressed="${pressed}" after the click, so it never opened.`,
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

describe("given the directory's people tab", () => {
  beforeEach(() => {
    state.members = [sam, ana];
    state.invites = [];
    state.requests = [];
    state.provenance = {};
    state.provenanceError = null;
    state.openDrawer.mockClear();
    state.departments = {
      show: false,
      departments: [],
      byUser: new Map(),
    };
  });
  afterEach(() => cleanup());

  describe("when an administrator opens it", () => {
    /** @scenario The directory's people tab opens on everybody */
    it("opens on everybody, with the three cuts offered beside it", () => {
      renderPeople();

      expect(cut(/^Everybody/)).toHaveAttribute("aria-pressed", "true");
      expect(cut(/^Members/)).toBeTruthy();
      expect(cut(/^Invited/)).toBeTruthy();
      expect(cut(/^Waiting to join/)).toBeTruthy();
      expect(screen.getByTestId("people-list")).toBeInTheDocument();
      expect(screen.getByTestId("seat-usage")).toBeInTheDocument();
    });

    /** @scenario The second-factor requirement is asked with the sign-in it guards */
    it("carries the second-factor requirement nowhere on it", () => {
      renderPeople();

      expect(screen.queryByTestId("two-step-requirement-card")).toBeNull();
    });

    /** @scenario One identity row carries a person wherever they appear */
    it("gives every person the same row of name and address", () => {
      renderPeople();

      const rows = screen.getAllByTestId("member-row");
      expect(rows).toHaveLength(2);
      expect(within(rows[0]!).getByText("Ana Diaz")).toBeInTheDocument();
      expect(within(rows[0]!).getByText("ana@acme.com")).toBeInTheDocument();
    });

    /** @scenario Opening a person puts them in the address bar */
    it("opens the person drawer with the person's id", async () => {
      renderPeople();

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

    /** @scenario A cut that is waiting on somebody says how many */
    it("counts only what is still waiting on the chip", () => {
      renderPeople();

      // The accepted invitation is history, not a thing anybody is waiting on.
      expect(cut(/^Invited, 2 people/)).toBeInTheDocument();
      expect(cut(/^Waiting to join, 1 person/)).toBeInTheDocument();
      // Everybody is the three cuts added up, and it is what somebody who
      // asked "how big is this organization" is actually reading.
      expect(cut(/^Everybody, 5 people/)).toBeInTheDocument();
    });

    /** @scenario The directory's people tab opens on everybody */
    it("lists members, invitations and requests in one table", () => {
      renderPeople();

      const list = screen.getByTestId("people-list");
      expect(within(list).getAllByTestId("member-row")).toHaveLength(2);
      expect(within(list).getAllByTestId("invite-row")).toHaveLength(2);
      expect(within(list).getAllByTestId("join-request-row")).toHaveLength(1);
    });

    /** @scenario One identity row carries a person wherever they appear */
    it("uses the same row for an invitation and for a request", async () => {
      renderPeople();

      await selectCut(/^Invited/);
      const invite = screen.getAllByTestId("invite-row")[0]!;
      expect(within(invite).getByText("dana@acme.com")).toBeInTheDocument();
      expect(within(invite).getByTestId("invite-status").textContent).toBe(
        "Invited",
      );

      await selectCut(/^Waiting to join/);
      const request = screen.getByTestId("join-request-row");
      expect(within(request).getByText("Rex Ford")).toBeInTheDocument();
      expect(within(request).getByText("acme.com")).toBeInTheDocument();
    });

    /** @scenario A cut that is waiting on somebody says how many */
    it("shows the whole invitation history under its own cut", async () => {
      renderPeople();

      // Everybody carries only what somebody is still waiting on; the invited
      // cut is where a revoked or accepted invitation stays readable.
      await selectCut(/^Invited/);
      expect(screen.getAllByTestId("invite-row")).toHaveLength(3);
    });
  });

  describe("when nothing is waiting", () => {
    /** @scenario A cut with nobody in it says so rather than emptying the table */
    it("says the cut is empty rather than showing a blank panel", async () => {
      renderPeople();

      await selectCut(/^Waiting to join/);

      expect(screen.getByTestId("people-list").textContent).toContain(
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
      renderPeople();

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
      renderPeople();

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
      renderPeople();

      expect(screen.queryByTestId("provenance-invited")).toBeNull();
      expect(screen.queryByTestId("provenance-domain")).toBeNull();
      expect(screen.queryByTestId("provenance-directory")).toBeNull();
    });
  });

  describe("when a member belongs to a department", () => {
    beforeEach(() => {
      state.departments = {
        show: true,
        departments: [{ id: "dep_eng", name: "Engineering" }],
        byUser: new Map([["user_sam", "dep_eng"]]),
      };
    });

    /** @scenario Every tab puts its action in the same place */
    it("puts its own action at the end of its first heading row, where every tab does", () => {
      const { container } = renderPeople();

      // The same kit and the same slot the departments tab uses. The two were
      // written separately, so agreeing here is the invariant rather than a
      // coincidence of one component.
      const heading = container.querySelector("header");
      if (!heading) throw new Error("the tab drew no heading row");
      expect(heading.textContent).toContain("People");
      expect(
        within(heading).getByRole("button", { name: /invite/i }),
      ).toBeInTheDocument();
    });

    /** @scenario A member's department is readable at a glance */
    it("names it beside their name, and says nothing for anybody else", () => {
      renderPeople();

      const rows = screen.getAllByTestId("member-row");
      const samRow = rows.find((row) => within(row).queryByText("Sam Rivera"))!;
      const chip = within(samRow).getByTestId("member-department-chip");
      expect(chip).toHaveTextContent("Engineering");
      // Ana belongs nowhere, so she carries no chip rather than an empty one.
      expect(screen.getAllByTestId("member-department-chip")).toHaveLength(1);
    });
  });

  describe("when the reasons cannot be worked out", () => {
    beforeEach(() => {
      state.provenanceError = new Error("boom");
    });

    /** @scenario The reason somebody is here is asked for separately */
    it("still lists everybody, and degrades only the chips", () => {
      renderPeople();

      expect(screen.getAllByTestId("member-row")).toHaveLength(2);
      expect(screen.getByTestId("section-error-notice")).toBeInTheDocument();
      expect(screen.queryByTestId("provenance-directory")).toBeNull();
    });
  });
});
