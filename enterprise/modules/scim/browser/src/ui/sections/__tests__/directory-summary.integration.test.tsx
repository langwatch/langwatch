/**
 * @vitest-environment jsdom
 * The Directory page's status band, lent to organization's Directory.
 * @see specs/identity/directory-administration.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    connections: [] as Record<string, unknown>[],
    groups: [] as Record<string, unknown>[],
    provenance: {} as Record<string, { source: string }>,
    readError: void 0 as unknown,
  },
}));

vi.mock("../../../behavior/use-member-provenance.ts", () => ({
  useMemberProvenance: ({ enabled }: { enabled: boolean }) => ({
    data: enabled ? state.provenance : void 0,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../../../behavior/scim-api.ts", () => {
  const read = (data: () => unknown) => ({ data: data(), isLoading: false, isError: false });
  const membership = (data: () => unknown) => ({
    useQuery: (_input: unknown, options: { enabled: boolean }) =>
      options.enabled ? read(data) : { data: void 0, isLoading: false, isError: false },
  });
  return {
    scimApi: {
      scimReconciliation: {
        getAll: {
          useQuery: () =>
            state.readError
              ? { data: void 0, isLoading: false, isError: true, error: state.readError }
              : read(() => ({ connections: state.connections, recentChanges: [] })),
        },
      },
    },
    directoryMembershipApi: {
      group: { listAll: membership(() => state.groups) },
    },
  };
});

// The pool shares a module graph across files: the band and its host load fresh over this mock.
vi.resetModules();
const { renderWithScimHost } = await import("../../../testing.tsx");
const { default: DirectorySummary } = await import("../directory-summary.tsx");

afterEach(cleanup);

beforeEach(() => {
  state.readError = void 0;
  state.connections = [
    {
      connectionId: "conn-1",
      providerId: "okta",
      connectionState: "ACTIVE",
      status: { headline: "Syncing", waitingFor: "", tone: "working" },
      lastPushedAtMs: Date.now() - 5 * 60 * 1000,
      managedPeople: 3,
    },
  ];
  state.groups = [
    { id: "g-1", name: "Engineering", scimSource: "okta" },
    { id: "g-2", name: "Made here", scimSource: null },
  ];
  state.provenance = {
    ana: { source: "directory" },
    sam: { source: "directory" },
    joe: { source: "directory" },
    ivy: { source: "invited" },
  };
});

describe("the directory's status band", () => {
  describe("given a running connection that manages three of four members", () => {
    it("names the source, the people it manages and the groups it sent", () => {
      renderWithScimHost(<DirectorySummary organizationId="org-1" canReadMembership />);

      expect(screen.getByTestId("directory-source")).toHaveTextContent("okta");
      expect(screen.getByTestId("directory-source-chip")).toHaveTextContent("Syncing");
      expect(screen.getByTestId("directory-managed-people")).toHaveTextContent("3");
      expect(screen.getByTestId("directory-groups-sent")).toHaveTextContent("1");
    });

    /** @scenario The people the directory did not put here are counted too */
    it("counts the members it does not manage, and why removing them there will not", () => {
      renderWithScimHost(<DirectorySummary organizationId="org-1" canReadMembership />);

      expect(screen.getByTestId("members-outside-directory")).toHaveTextContent("1 of 4");
      expect(screen.getByText(/removing them there will not remove them here/)).toBeInTheDocument();
    });
  });

  describe("given no identity provider is connected", () => {
    /** @scenario An organization with no connection is offered the way to set one up */
    it("says nobody arrives on their own, and where to connect one", () => {
      state.connections = [];
      renderWithScimHost(<DirectorySummary organizationId="org-1" canReadMembership />);

      expect(screen.getByTestId("directory-source-chip")).toHaveTextContent("Not set up");
      expect(screen.getByTestId("directory-source-chip")).toHaveAttribute(
        "title",
        "No identity provider is connected, so nothing is provisioned here automatically.",
      );
      expect(screen.getByTestId("connect-identity-provider")).toHaveAttribute(
        "href",
        "/settings/authentication",
      );
      expect(screen.queryByTestId("manage-identity-providers")).not.toBeInTheDocument();
    });
  });

  describe("given several connections with long provider names", () => {
    const connection = (id: string, providerId: string, tone: string, headline: string) => ({
      connectionId: id,
      providerId,
      connectionState: "ACTIVE",
      status: { headline, waitingFor: "", tone },
      lastPushedAtMs: Date.now() - 60 * 1000,
      managedPeople: 1,
    });

    it("names every source with its own status, none collapsed into a count", () => {
      state.connections = [
        connection("c-1", "okta", "working", "Syncing"),
        connection(
          "c-2",
          "azure-active-directory-production-tenant",
          "attention",
          "Needs attention",
        ),
        connection("c-3", "google-workspace", "idle", "Waiting for first push"),
        connection("c-4", "onelogin", "working", "Syncing"),
      ];
      renderWithScimHost(<DirectorySummary organizationId="org-1" canReadMembership />);

      const sources = screen.getAllByTestId("directory-source");
      expect(sources.map((source) => source.textContent)).toEqual([
        "oktaSyncing",
        "azure-active-directory-production-tenantNeeds attention",
        "google-workspaceWaiting for first push",
        "oneloginSyncing",
      ]);
      expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument();
    });

    it("offers the one way to the page that owns connections, not a second control", () => {
      renderWithScimHost(<DirectorySummary organizationId="org-1" canReadMembership />);

      const link = screen.getByTestId("manage-identity-providers");
      expect(link).toHaveAttribute("href", "/settings/authentication");
      expect(link).toHaveTextContent("Manage identity providers");
      expect(screen.queryByTestId("connect-identity-provider")).not.toBeInTheDocument();
      expect(
        screen
          .getAllByRole("link")
          .filter((a) => a.getAttribute("href") === "/settings/authentication"),
      ).toHaveLength(1);
    });
  });

  describe("given a reader who may not read the membership", () => {
    /** @scenario A reader who may not read groups is told nothing they cannot have */
    it("says the groups and the unmanaged members are unavailable, never zero", () => {
      renderWithScimHost(<DirectorySummary organizationId="org-1" canReadMembership={false} />);

      expect(screen.getAllByTestId("directory-fact-unavailable")).toHaveLength(2);
      expect(screen.queryByTestId("members-outside-directory")).not.toBeInTheDocument();
      expect(screen.queryByTestId("directory-groups-sent")).not.toBeInTheDocument();
      expect(screen.getByTestId("directory-managed-people")).toHaveTextContent("3");
    });
  });
});

describe("given a plan that does not carry directory sync", () => {
  it("says it is an Enterprise feature rather than that the read failed", () => {
    state.readError = { data: { error: { code: "enterprise_plan_required" } } };
    renderWithScimHost(<DirectorySummary organizationId="org-1" canReadMembership />);

    expect(screen.getByText("Directory sync on Enterprise")).toBeInTheDocument();
    expect(screen.queryByTestId("directory-summary")).not.toBeInTheDocument();
  });
});
