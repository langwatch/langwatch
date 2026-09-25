/**
 * @vitest-environment jsdom
 * The members page's cuts and the chip that says why a member is here.
 * @see specs/identity/directory-administration.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../../testing.tsx";
import MembersScreen from "../members.screen.tsx";

const state = vi.hoisted(() => ({
  provenanceFails: false,
  requests: [] as unknown[],
}));

vi.mock("../../../../behavior/organization-api.ts", () => {
  const member = (userId: string, name: string) => ({
    userId,
    role: "MEMBER",
    disabledAt: null,
    user: { id: userId, name, email: `${userId}@acme.com`, image: null, deactivatedAt: null },
  });
  const invite = (id: string, displayStatus: string) => ({
    id,
    email: `${id}@acme.com`,
    inviteCode: `code-${id}`,
    expiration: null,
    displayStatus,
    role: "MEMBER",
    teamIds: "",
    teamAssignments: null,
  });
  const answers: Record<string, unknown> = {
    "organization.getOrganizationWithMembersAndTheirTeams": {
      id: "org-1",
      name: "Acme",
      members: [member("sam", "Sam"), member("ana", "Ana")],
      teams: [],
    },
    "invite.getOrganizationPendingInvites": [
      invite("ivy", "PENDING"),
      invite("ian", "PENDING"),
      invite("old", "ACCEPTED"),
    ],
    "organization.getMemberProvenance": {
      sam: { source: "domain", domain: "acme.com", automatic: true },
      ana: { source: "unknown" },
    },
    "plan.getActivePlan": { type: "ENTERPRISE", free: false, maxMembers: 100 },
    "departments.assignments": { users: [], teams: [], projects: [] },
    "limits.getUsage": { membersCount: 2, membersLiteCount: 0 },
  };

  const endpoint = (path: string) => ({
    useQuery: () =>
      path === "organization.getMemberProvenance" && state.provenanceFails
        ? { data: undefined, isError: true, isLoading: false, refetch: vi.fn() }
        : { data: answers[path] ?? [], isError: false, isLoading: false, refetch: vi.fn() },
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
    joining: { domainJoin: "request", joinDomains: [] },
    savingJoining: false,
    setJoining: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  }),
}));

vi.mock("../../../../behavior/use-two-step-requirement.ts", () => ({
  useTwoStepRequirement: () => ({ show: false, mfaRequired: false, byUser: new Map() }),
}));

vi.mock("../../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: { HAS_EMAIL_PROVIDER_KEY: true } }),
}));

vi.mock("../../../../behavior/use-required-session.ts", () => ({
  useRequiredSession: () => ({ data: { user: { id: "ana" } } }),
}));

const renderMembers = (query: Record<string, string> = {}) =>
  renderWithOrganizationHost(
    <MembersScreen />,
    new FakeOrganizationHost({ grants: new Set(["organization:manage"]), query }),
  );

beforeEach(() => {
  state.provenanceFails = false;
  state.requests = [
    {
      joinRequestId: "jr-1",
      name: "Joe",
      domain: "acme.com",
      requestedAt: "2026-09-01T00:00:00.000Z",
      expiresAt: null,
    },
  ];
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("the members page's cuts", () => {
  describe("given two invitations are outstanding and one colleague has asked to join", () => {
    /** @scenario A cut that is waiting on somebody says how many */
    it("counts two on the invited cut and one on the waiting cut", () => {
      renderMembers();

      const cuts = screen.getByTestId("people-cuts");
      expect(cuts).toHaveTextContent("Invited 2");
      expect(cuts).toHaveTextContent("Waiting to join 1");
      expect(cuts).toHaveTextContent("Everybody 5");
    });
  });

  describe("given nobody has asked to join", () => {
    /** @scenario A cut with nobody in it says so rather than emptying the table */
    it("says nobody is waiting and offers nothing to approve", () => {
      state.requests = [];
      renderMembers({ people: "waiting" });

      expect(screen.getByTestId("people-cut-empty")).toHaveTextContent(
        "Nobody is waiting to join.",
      );
      expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
      expect(screen.queryByText("Sam")).not.toBeInTheDocument();
    });
  });
});

describe("why a member is here", () => {
  describe("given sam joined automatically on a matching domain", () => {
    /** @scenario A member who walked in on the domain policy says nobody approved */
    it("marks sam with a domain chip that says nobody approved it", () => {
      renderMembers();

      const chip = screen.getByTestId("provenance-domain");
      expect(chip).toHaveTextContent("Domain");
      expect(chip).toHaveAttribute("title", expect.stringContaining("Nobody approved this"));
      expect(chip).toHaveAttribute("title", expect.stringContaining("acme.com"));
    });
  });

  describe("given ana created the organization herself", () => {
    /** @scenario A member we cannot explain carries no chip rather than a guess */
    it("gives exactly one chip, and it is sam's", () => {
      renderMembers();

      expect(screen.getAllByTestId(/^provenance-/)).toHaveLength(1);
    });
  });

  describe("given the read that explains each member fails", () => {
    /** @scenario The reason somebody is here is asked for separately */
    it("still lists everybody and says only that the reasons could not be worked out", () => {
      state.provenanceFails = true;
      renderMembers();

      expect(screen.getByText("Sam")).toBeInTheDocument();
      expect(screen.getByText("Ana")).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^provenance-/)).toHaveLength(0);
      expect(screen.getByText(/couldn.t work out how everybody got here/i)).toBeInTheDocument();
    });
  });
});
