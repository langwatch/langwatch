/**
 * @vitest-environment jsdom
 * The Directory: the status band above three tabs, each with its count.
 * @see specs/identity/directory-administration.feature
 */
import "@testing-library/jest-dom/vitest";
import type { UiDirectorySummaryProps } from "@langwatch/browser-host/declarations";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../../testing.tsx";
import DirectoryScreen from "../directory.screen.tsx";

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
    "organization.getDirectoryCounts": {
      members: 2,
      openInvites: 2,
      joinRequests: 1,
      groups: 2,
      teams: 0,
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
    "joinRequests.pending": [{ joinRequestId: "jr-1" }],
    "group.listAll": [
      {
        id: "g1",
        name: "Engineering",
        scimSource: "okta",
        grants: [
          {
            role: "ADMIN",
            customRoleName: null,
            scopeType: "ORGANIZATION",
            scopeName: "Acme",
            scopeId: "org-1",
          },
        ],
        memberCount: 3,
      },
      { id: "g2", name: "Hand-made", scimSource: null, grants: [], memberCount: 1 },
    ],
    "team.getTeamsWithGrants": [],
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
    automaticJoins: [],
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

function StatusBand({ organizationId, canReadMembership }: UiDirectorySummaryProps) {
  return (
    <div data-testid="directory-status-band">
      {organizationId}:{String(canReadMembership)}
    </div>
  );
}

const ADMIN = new Set(["organization:manage", "sso:view"]);

const renderDirectory = ({
  query = {},
  grants = ADMIN,
}: {
  query?: Record<string, string>;
  grants?: ReadonlySet<string>;
} = {}) =>
  renderWithOrganizationHost(
    <DirectoryScreen />,
    new FakeOrganizationHost({ grants, query, isEnterprise: true, directorySummary: StatusBand }),
  );

beforeEach(() => {
  state.provenanceFails = false;
  state.requests = [];
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("the directory page", () => {
  describe("when an administrator opens it", () => {
    /** @scenario The directory's people tab opens on everybody */
    it("opens the people tab, listing members and invitations together", () => {
      renderDirectory();

      expect(screen.getByRole("heading", { name: "Directory" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /People/ })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Sam")).toBeInTheDocument();
      expect(screen.getByTestId("people-cuts")).toHaveTextContent("Everybody");
    });

    /** @scenario A tab that names a count names it the same way as its siblings */
    it("counts everybody on the people tab and every group on the groups tab", () => {
      renderDirectory();

      expect(screen.getByRole("tab", { name: /People/ })).toHaveTextContent("People 5");
      expect(screen.getByRole("tab", { name: /Groups/ })).toHaveTextContent("Groups 2");
      expect(screen.getByRole("tab", { name: /Teams/ })).toHaveTextContent("Teams & projects 0");
    });

    /** @scenario The tabs name the subjects this page owns */
    it("offers the people, the teams and the groups, and no tab for how people arrive", () => {
      renderDirectory();

      const names = screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
      expect(names).toHaveLength(3);
      expect(names[0]).toMatch(/^People/);
      expect(names[1]).toMatch(/^Teams/);
      expect(names[2]).toMatch(/^Groups/);
    });

    /** @scenario A reader who may not view governance is offered no departments tab */
    it("offers no departments tab and lands on the people when the address names it", () => {
      renderDirectory({ query: { tab: "departments" } });

      expect(screen.queryByRole("tab", { name: /Departments/ })).not.toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /People/ })).toHaveAttribute("aria-selected", "true");
    });

    /** @scenario The page leads with whether it is working */
    it("draws the directory's status band above the tabs", () => {
      renderDirectory();

      const band = screen.getByTestId("directory-status-band");
      expect(band).toHaveTextContent("org-1:true");
      const tabs = screen.getByRole("tablist");
      expect(band.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("writes the picked tab into the address", async () => {
      const { host } = renderDirectory();

      await userEvent.click(screen.getByRole("tab", { name: /Groups/ }));

      expect(host.queries).toEqual([{ tab: "groups" }]);
    });
  });

  describe("when the address names the groups tab", () => {
    /** @scenario The groups tab holds the hand-made ones as well as the sent ones */
    it("opens on the groups, the sent and the hand-made alike", () => {
      renderDirectory({ query: { tab: "groups" } });

      expect(screen.getByRole("tab", { name: /Groups/ })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByText("Engineering")).toBeInTheDocument();
      expect(screen.getByText("Hand-made")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add a group" })).toBeInTheDocument();
    });

    /** @scenario A directory group is marked in the list */
    it("lists the groups and marks only the one the directory sent", () => {
      renderDirectory({ query: { tab: "groups" } });

      expect(screen.getByTestId("groups-list")).toBeInTheDocument();
      const rows = screen.getAllByTestId("group-row");
      expect(rows).toHaveLength(2);
      const chips = screen.getAllByTestId("group-directory-chip");
      expect(chips).toHaveLength(1);
      expect(rows[0]).toContainElement(chips[0] ?? null);
    });
  });

  describe("when the groups tab lists what each group grants", () => {
    /** @scenario The groups the directory sent say what they grant */
    it("names the roles a directory group carries and says so for one that grants nothing", () => {
      renderDirectory({ query: { tab: "groups" } });

      const rows = screen.getAllByTestId("group-row");
      expect(rows[0]).toHaveTextContent("ADMIN");
      expect(rows[1]).toHaveTextContent("No access configured");
    });
  });

  describe("when the address names a tab the page does not have", () => {
    it("falls back to the people", () => {
      renderDirectory({ query: { tab: "provisioning" } });

      expect(screen.getByRole("tab", { name: /People/ })).toHaveAttribute("aria-selected", "true");
    });
  });

  describe("when the reader may see single sign-on only", () => {
    it("says which permission the page takes, and draws no tab", () => {
      renderDirectory({ grants: new Set(["sso:view"]) });

      expect(screen.getByText(/organization:manage/)).toBeInTheDocument();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });
  });
});
