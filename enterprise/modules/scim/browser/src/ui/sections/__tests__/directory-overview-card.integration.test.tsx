/**
 * @vitest-environment jsdom
 * The directory card on organization's Authentication overview.
 * @see specs/identity/organization-authentication-settings.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    connections: [] as Record<string, unknown>[],
    groups: [] as Record<string, unknown>[],
    provenance: {} as Record<string, { source: string }>,
    membershipQueried: [] as string[],
  },
}));

vi.mock("../../../behavior/scim-api.ts", () => {
  const read = (data: () => unknown) => ({ data: data(), isLoading: false, isError: false });
  return {
    scimApi: {
      scimReconciliation: {
        getAll: {
          useQuery: () => read(() => ({ connections: state.connections, recentChanges: [] })),
        },
      },
    },
    directoryMembershipApi: {
      group: {
        listAll: {
          useQuery: (_input: unknown, options: { enabled: boolean }) => {
            if (options.enabled) state.membershipQueried.push("group.listAll");
            return options.enabled
              ? read(() => state.groups)
              : { data: void 0, isLoading: false, isError: false };
          },
        },
      },
      organization: {
        getMemberProvenance: {
          useQuery: (_input: unknown, options: { enabled: boolean }) => {
            if (options.enabled) state.membershipQueried.push("organization.getMemberProvenance");
            return options.enabled
              ? read(() => state.provenance)
              : { data: void 0, isLoading: false, isError: false };
          },
        },
      },
    },
  };
});

import { renderWithScimHost } from "../../../testing.tsx";
import { DirectoryOverviewCard } from "../directory-overview-card.tsx";

afterEach(cleanup);

beforeEach(() => {
  state.connections = [
    {
      connectionId: "conn-1",
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
  state.membershipQueried = [];
});

describe("given a directory that manages three of four members", () => {
  /** @scenario "The directory card carries the organization's real numbers" */
  it("says three of four, that the fourth arrived another way, and offers the members", () => {
    renderWithScimHost(<DirectoryOverviewCard organizationId="org-1" canReadMembership />);

    expect(screen.getByTestId("directory-card-members")).toHaveTextContent("3 of 4");
    expect(screen.getByText(/1 arrived another way/)).toBeInTheDocument();
    expect(screen.getByText("See who it manages").closest("a")).toHaveAttribute(
      "href",
      "/settings/members?people=members",
    );
    expect(
      screen.getAllByTestId("directory-card-group-chip").map((chip) => chip.textContent),
    ).toEqual(["Engineering"]);
  });
});

describe("given a reader who may see single sign-on but may not manage the organization", () => {
  /** @scenario "A reader who may not read membership is told so" */
  it("says the counts are unavailable rather than reading zero, and never asks for them", () => {
    renderWithScimHost(<DirectoryOverviewCard organizationId="org-1" canReadMembership={false} />);

    expect(screen.getAllByTestId("directory-fact-unavailable")).toHaveLength(2);
    expect(screen.queryByTestId("directory-card-members")).toBeNull();
    expect(state.membershipQueried).toEqual([]);
  });
});

describe("given a connection whose provider has not pushed yet", () => {
  it("says it is waiting for the first push and points at the connector", () => {
    state.connections = [{ ...state.connections[0], lastPushedAtMs: null }];
    renderWithScimHost(<DirectoryOverviewCard organizationId="org-1" canReadMembership />);

    expect(screen.getByText("Waiting for the first push")).toBeInTheDocument();
    expect(screen.getByText("Open the connector").closest("a")).toHaveAttribute(
      "href",
      "/settings/authentication/connectors",
    );
  });
});
