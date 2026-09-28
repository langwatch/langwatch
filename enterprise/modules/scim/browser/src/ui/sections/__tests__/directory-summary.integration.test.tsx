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
  },
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
          useQuery: () => read(() => ({ connections: state.connections, recentChanges: [] })),
        },
      },
    },
    directoryMembershipApi: {
      group: { listAll: membership(() => state.groups) },
      organization: { getMemberProvenance: membership(() => state.provenance) },
    },
  };
});

// The pool shares a module graph across files: the band and its host load fresh over this mock.
vi.resetModules();
const { renderWithScimHost } = await import("../../../testing.tsx");
const { default: DirectorySummary } = await import("../directory-summary.tsx");

afterEach(cleanup);

beforeEach(() => {
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

      expect(screen.getByTestId("directory-source-chip")).toHaveTextContent("okta · Syncing");
      expect(screen.getByTestId("directory-managed-people")).toHaveTextContent("3");
      expect(screen.getByText("Groups it sent").closest("div")?.parentElement).toHaveTextContent(
        "1",
      );
    });

    /** @scenario The people the directory did not put here are counted too */
    it("counts the members it does not manage, and why removing them there will not", () => {
      renderWithScimHost(<DirectorySummary organizationId="org-1" canReadMembership />);

      expect(screen.getByTestId("members-outside-directory")).toHaveTextContent("1 of 4");
      expect(screen.getByText(/removing them there will not remove them here/)).toBeInTheDocument();
    });
  });

  describe("given no identity provider is connected", () => {
    it("says nobody arrives on their own, and where to connect one", () => {
      state.connections = [];
      renderWithScimHost(<DirectorySummary organizationId="org-1" canReadMembership />);

      expect(screen.getByTestId("directory-source-chip")).toHaveTextContent("Not set up yet");
      expect(screen.getByTestId("connect-identity-provider")).toHaveAttribute(
        "href",
        "/settings/authentication",
      );
    });
  });

  describe("given a reader who may not read the membership", () => {
    /** @scenario A reader who may not read groups is told nothing they cannot have */
    it("says the groups and the unmanaged members are unavailable, never zero", () => {
      renderWithScimHost(<DirectorySummary organizationId="org-1" canReadMembership={false} />);

      expect(screen.getAllByTestId("directory-fact-unavailable")).toHaveLength(2);
      expect(screen.queryByTestId("members-outside-directory")).not.toBeInTheDocument();
    });
  });
});
