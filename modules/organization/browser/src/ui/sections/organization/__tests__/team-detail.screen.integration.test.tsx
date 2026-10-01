/**
 * @vitest-environment jsdom
 * Team settings: the page main served at /settings/teams/:team.
 * @see specs/team-settings.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../behavior/organization-api.ts", () => {
  const team = {
    id: "team-1",
    name: "Local Dev Team",
    slug: "local-dev-team",
    organizationId: "org-1",
    members: [],
    projects: [],
  };
  const mutation = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  const refresh = { invalidate: () => Promise.resolve(), refetch: () => Promise.resolve() };

  return {
    api: {
      useUtils: () => ({
        organization: { getAll: refresh, getScopeGraph: refresh },
        team: { getTeamWithMembers: refresh },
      }),
      team: {
        getTeamWithMembers: {
          useQuery: () => ({ data: team, isLoading: false, error: null }),
        },
        update: mutation,
        archiveById: mutation,
      },
      project: { archiveById: mutation },
      organization: {
        getAllOrganizationMembers: { useQuery: () => ({ data: [] }) },
      },
    },
  };
});

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../../testing.tsx";
import TeamDetailScreen from "../team-detail.screen.tsx";

class TeamAddressHost extends FakeOrganizationHost {
  override route() {
    return { params: { team: "local-dev-team" }, query: {} };
  }
}

describe("given the team settings page", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when it opens for a team the reader may edit", () => {
    /** @scenario "The team settings page offers the organization's members as a link" */
    it("offers Manage organization members as a link, as main does", async () => {
      renderWithOrganizationHost(<TeamDetailScreen />, new TeamAddressHost());

      const link = await screen.findByRole("link", { name: "Manage organization members" });

      expect(link).toHaveAttribute("href", "/settings/members");
    });
  });
});
