/**
 * @vitest-environment jsdom
 * Everybody in the organization as three cuts of one list, on the Directory's people tab.
 * @see specs/identity/directory-administration.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../../testing.tsx";
import MembersScreen from "../members.screen.tsx";

const state = vi.hoisted(() => ({
  members: [] as unknown[],
  invites: [] as unknown[],
  requests: [] as unknown[],
  provenance: {} as Record<string, unknown>,
  provenanceFails: false,
  departments: {
    show: false,
    departments: [] as { id: string; name: string }[],
    byUser: new Map<string, string>(),
  },
}));

vi.mock("../../../../behavior/organization-api.ts", () => {
  const answers = (path: string): unknown => {
    if (path === "organization.getOrganizationWithMembersAndTheirTeams") {
      return { id: "org-1", name: "Acme", members: state.members, teams: [] };
    }
    if (path === "invite.getOrganizationPendingInvites") return state.invites;
    if (path === "organization.getMemberProvenance") return state.provenance;
    if (path === "plan.getActivePlan") return { type: "ENTERPRISE", free: false, maxMembers: 100 };
    return [];
  };

  const endpoint = (path: string) => ({
    useQuery: () =>
      path === "organization.getMemberProvenance" && state.provenanceFails
        ? { data: undefined, isError: true, error: new Error("boom"), refetch: vi.fn() }
        : { data: answers(path), isError: false, error: null, refetch: vi.fn() },
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    invalidate: vi.fn(),
    fetch: vi.fn(),
  });
  const namespace = (prefix: string): Record<string, unknown> =>
    new Proxy(endpoint(prefix) as Record<string, unknown>, {
      get: (target: Record<string, unknown>, name) => {
        if (name in target) return target[name as string];
        if (typeof name !== "string") return void 0;
        return namespace(prefix ? `${prefix}.${name}` : name);
      },
    }) as Record<string, unknown>;
  const root = namespace("");
  root.useUtils = () => root;
  return { api: root };
});

vi.mock("../../../../behavior/use-join-requests.ts", () => ({
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

vi.mock("../../../../behavior/user/use-user-avatar-url.ts", () => ({
  useUserAvatarUrl: (image?: string | null) => image ?? null,
}));

vi.mock("../../../../behavior/use-two-step-requirement.ts", () => ({
  useTwoStepRequirement: () => ({ show: false, mfaRequired: false, byUser: new Map() }),
}));

vi.mock("../../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: { HAS_EMAIL_PROVIDER_KEY: true } }),
}));

vi.mock("../../../../behavior/use-required-session.ts", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user_ana" } } }),
}));

// Seat usage and the department picker are covered where they live; here they only stay out of
// the way.
vi.mock("../../member-seat-usage.tsx", () => ({
  MemberSeatUsage: () => <div data-testid="seat-usage">Seats</div>,
}));
vi.mock("../../department-picker.tsx", () => ({
  DepartmentPicker: () => <div data-testid="department-picker" />,
}));
vi.mock("../../../../behavior/use-department-column.ts", () => ({
  useDepartmentColumn: () => ({
    show: state.departments.show,
    byUser: state.departments.byUser,
    byTeam: new Map(),
    byProject: new Map(),
    departments: state.departments.departments,
    refetch: vi.fn(),
  }),
}));

const renderPeople = (query: Record<string, string> = {}) =>
  renderWithOrganizationHost(
    <MembersScreen />,
    new FakeOrganizationHost({ grants: new Set(["organization:manage"]), query }),
  );

/** A cut chip, by the accessible name FilterChips builds from label and count. */
const cut = (name: RegExp) => screen.getByRole("button", { name });

const person = (userId: string, name: string, role: string) => ({
  userId,
  role,
  disabledAt: null,
  user: {
    id: userId,
    name,
    email: `${name.split(" ")[0]!.toLowerCase()}@acme.com`,
    image: null,
    deactivatedAt: null,
  },
});
const sam = person("user_sam", "Sam Rivera", "MEMBER");
const ana = person("user_ana", "Ana Diaz", "ADMIN");

const invite = (id: string, email: string, displayStatus: string) => ({
  id,
  email,
  role: "MEMBER",
  displayStatus,
  expiration: displayStatus === "ACCEPTED" ? null : "2026-09-03T09:00:00.000Z",
  inviteCode: `code_${id}`,
  teamIds: "",
});

beforeEach(() => {
  state.members = [sam, ana];
  state.invites = [];
  state.requests = [];
  state.provenance = {};
  state.provenanceFails = false;
  state.departments = { show: false, departments: [], byUser: new Map() };
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("given the directory's people tab", () => {
  describe("when an administrator opens it", () => {
    /** @scenario The directory's people tab opens on everybody */
    it("opens on everybody, with the three cuts offered beside it", () => {
      renderPeople();

      expect(cut(/^Everybody/)).toHaveAttribute("aria-pressed", "true");
      expect(cut(/^Members/)).toBeInTheDocument();
      expect(cut(/^Invited/)).toBeInTheDocument();
      expect(cut(/^Waiting to join/)).toBeInTheDocument();
      expect(screen.getByTestId("people-list")).toBeInTheDocument();
      expect(screen.getByTestId("seat-usage")).toBeInTheDocument();
    });

    /** @scenario The directory's people tab opens on everybody */
    it("keeps the chosen cut in the address, and leaves everybody out of it", async () => {
      const { host } = renderPeople();

      await userEvent.click(cut(/^Invited/));
      await userEvent.click(cut(/^Everybody/));

      expect(host.queries).toEqual([{ people: "invited" }, { people: undefined }]);
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

    /** @scenario One identity row carries a person wherever they appear */
    it("marks a switched-off member and a deactivated one, and nobody else", () => {
      state.members = [
        sam,
        { ...ana, disabledAt: new Date("2026-09-01T09:00:00.000Z") },
        {
          ...person("user_rex", "Rex Ito", "MEMBER"),
          user: { ...person("user_rex", "Rex Ito", "MEMBER").user, deactivatedAt: new Date() },
        },
      ];
      renderPeople();

      expect(screen.getByTestId("member-disabled").title).toBe(
        "Their access in this organization is switched off.",
      );
      expect(screen.getAllByTestId("member-disabled")).toHaveLength(1);
      expect(screen.getAllByTestId("member-deactivated")).toHaveLength(1);
    });

    /** @scenario Opening a person puts them in the address bar */
    it("opens the person drawer with the person's id", async () => {
      const { host } = renderPeople();

      await userEvent.click(screen.getByLabelText("Open Sam Rivera"));

      expect(host.overlays).toContainEqual({ name: "person", props: { userId: "user_sam" } });
    });
  });

  describe("when somebody is waiting", () => {
    beforeEach(() => {
      state.invites = [
        invite("inv_1", "dana@acme.com", "PENDING"),
        invite("inv_2", "eve@acme.com", "EXPIRED"),
        invite("inv_3", "old@acme.com", "ACCEPTED"),
      ];
      state.requests = [
        {
          joinRequestId: "jreq_1",
          name: "Rex Ford",
          domain: "acme.com",
          requestedAt: "2026-08-20T09:00:00.000Z",
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
      expect(cut(/^Everybody, 5 people/)).toBeInTheDocument();
    });

    /** @scenario The directory's people tab opens on everybody */
    it("lists members, invitations and requests in one list", () => {
      renderPeople();

      const list = screen.getByTestId("people-list");
      expect(within(list).getAllByTestId("member-row")).toHaveLength(2);
      expect(within(list).getAllByTestId("invite-row")).toHaveLength(2);
      expect(within(list).getAllByTestId("join-request-row")).toHaveLength(1);
    });

    /** @scenario One identity row carries a person wherever they appear */
    it("uses the same row for an invitation", () => {
      renderPeople({ people: "invited" });

      const row = screen.getAllByTestId("invite-row")[0]!;
      expect(within(row).getByText("dana@acme.com")).toBeInTheDocument();
      expect(within(row).getByTestId("invite-status").textContent).toBe("Invited");
    });

    /** @scenario One identity row carries a person wherever they appear */
    it("uses the same row for a request", () => {
      renderPeople({ people: "waiting" });

      const row = screen.getByTestId("join-request-row");
      expect(within(row).getByText("Rex Ford")).toBeInTheDocument();
      expect(within(row).getByText("acme.com")).toBeInTheDocument();
      expect(screen.queryAllByTestId("member-row")).toHaveLength(0);
    });

    /** @scenario A cut that is waiting on somebody says how many */
    it("shows the whole invitation history under its own cut", () => {
      renderPeople({ people: "invited" });

      expect(cut(/^Invited/)).toHaveAttribute("aria-pressed", "true");
      expect(screen.getAllByTestId("invite-row")).toHaveLength(3);
    });
  });

  describe("when nothing is waiting", () => {
    /** @scenario A cut with nobody in it says so rather than emptying the table */
    it("says the cut is empty rather than showing a blank panel", () => {
      renderPeople({ people: "waiting" });

      expect(screen.getByTestId("people-list").textContent).toContain("Nobody is waiting to join");
      expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    });
  });

  describe("when the directory created somebody", () => {
    /** @scenario A member the directory owns says so */
    it("marks them as the directory's", () => {
      state.provenance = { user_sam: { source: "directory", providerId: "okta" } };
      renderPeople();

      expect(screen.getByTestId("provenance-directory")).toBeInTheDocument();
    });
  });

  describe("when the directory created some of the members", () => {
    /** @scenario "The directory's own people are listed by name" */
    it("lists each by name and address, with the access they hold and where they came from", () => {
      state.provenance = {
        user_sam: { source: "directory", providerId: "okta" },
        user_ana: { source: "directory", providerId: "okta" },
      };
      renderPeople();

      const rows = screen.getAllByTestId("member-row");
      expect(rows).toHaveLength(2);
      const [samRow, anaRow] = ["Sam Rivera", "Ana Diaz"].map((name) =>
        rows.find((row) => within(row).queryByText(name))!,
      );
      expect(within(samRow!).getByText("sam@acme.com")).toBeInTheDocument();
      expect(within(samRow!).getByText("Member")).toBeInTheDocument();
      expect(within(anaRow!).getByText("ana@acme.com")).toBeInTheDocument();
      expect(within(anaRow!).getByText("Admin")).toBeInTheDocument();
      for (const row of [samRow!, anaRow!]) {
        expect(within(row).getByTestId("provenance-directory")).toBeInTheDocument();
      }
    });
  });

  describe("when somebody walked in on the domain policy", () => {
    /** @scenario A member who walked in on the domain policy says nobody approved */
    it("names the domain and says nobody approved it", () => {
      state.provenance = { user_sam: { source: "domain", domain: "acme.com", automatic: true } };
      renderPeople();

      const chip = screen.getByTestId("provenance-domain");
      expect(chip).toHaveAttribute("title", expect.stringContaining("acme.com"));
      expect(chip).toHaveAttribute("title", expect.stringContaining("Nobody approved this"));
    });
  });

  describe("when nothing explains how somebody got here", () => {
    /** @scenario A member we cannot explain carries no chip rather than a guess */
    it("shows no chip at all", () => {
      state.provenance = { user_ana: { source: "unknown" } };
      renderPeople();

      expect(screen.queryAllByTestId(/^provenance-/)).toHaveLength(0);
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
    it("puts its own action at the end of its first heading row", () => {
      const { container } = renderPeople();

      const heading = container.querySelector("header");
      if (!heading) throw new Error("the tab drew no heading row");
      expect(heading.textContent).toContain("People");
      expect(within(heading).getByRole("button", { name: /invite/i })).toBeInTheDocument();
    });

    /** @scenario A member's department is readable at a glance */
    it("names it beside their name, and says nothing for anybody else", () => {
      renderPeople();

      const samRow = screen
        .getAllByTestId("member-row")
        .find((row) => within(row).queryByText("Sam Rivera"))!;
      expect(within(samRow).getByTestId("member-department-chip")).toHaveTextContent("Engineering");
      expect(screen.getAllByTestId("member-department-chip")).toHaveLength(1);
    });
  });

  describe("when the reasons cannot be worked out", () => {
    /** @scenario The reason somebody is here is asked for separately */
    it("still lists everybody, and degrades only the chips", () => {
      state.provenanceFails = true;
      renderPeople();

      expect(screen.getAllByTestId("member-row")).toHaveLength(2);
      expect(screen.getByTestId("section-error-notice")).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^provenance-/)).toHaveLength(0);
    });
  });
});
