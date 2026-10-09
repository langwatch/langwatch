/**
 * Real-Chromium team settings: typing a new name autosaves it.
 * @see specs/team-settings.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

const { updateTeam } = vi.hoisted(() => ({ updateTeam: vi.fn() }));

vi.mock("../../../../behavior/organization-api.ts", () => {
  const team = {
    id: "team-1",
    name: "Local Dev Team",
    slug: "local-dev-team",
    organizationId: "org-1",
    members: [
      {
        userId: "user-1",
        teamId: "team-1",
        role: "ADMIN",
        assignedRoleId: null,
        assignedRole: null,
        user: { id: "user-1", name: "Admin", email: "admin@example.com", image: null },
      },
    ],
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
        update: { useMutation: () => ({ mutate: updateTeam, isPending: false }) },
        archiveById: mutation,
      },
      project: { archiveById: mutation },
      role: { getAll: { useQuery: () => ({ data: [], isLoading: false }) } },
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

describe("given the team settings page in a real browser", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the reader renames the team", () => {
    /** @scenario "Renaming a team saves the new name" */
    it("saves the new name without a save button", async () => {
      renderWithOrganizationHost(<TeamDetailScreen />, new TeamAddressHost());
      const name = await screen.findByTestId("team-form-name");

      await userEvent.fill(name, "Renamed Team");
      await userEvent.keyboard("{Enter}");

      await waitFor(() =>
        expect(updateTeam).toHaveBeenLastCalledWith(
          {
            teamId: "team-1",
            name: "Renamed Team",
            members: [{ userId: "user-1", role: "ADMIN", customRoleId: undefined }],
          },
          expect.anything(),
        ),
      );
    });
  });
});
