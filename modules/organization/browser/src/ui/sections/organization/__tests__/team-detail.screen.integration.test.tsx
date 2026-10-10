/**
 * @vitest-environment jsdom
 * Team settings: the page main served at /settings/teams/:team.
 * @see specs/team-settings.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { updateTeam, readFailure } = vi.hoisted(() => ({
  updateTeam: vi.fn(),
  readFailure: { current: null as unknown },
}));

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
          useQuery: () =>
            readFailure.current
              ? { data: undefined, isLoading: false, error: readFailure.current }
              : { data: team, isLoading: false, error: null },
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

describe("given the team settings page", () => {
  afterEach(() => {
    cleanup();
    readFailure.current = null;
  });

  describe("when the team read answers not found, as for an archived team", () => {
    /** @scenario "An archived team's address says the team was not found" */
    it("shows a not-found message instead of a loading skeleton", async () => {
      readFailure.current = { data: { code: "NOT_FOUND" }, message: "Team not found" };
      renderWithOrganizationHost(<TeamDetailScreen />, new TeamAddressHost());

      expect(await screen.findByText("Team not found")).toBeInTheDocument();
    });
  });

  describe("when it opens for a team the reader may edit", () => {
    /** @scenario "The team settings page offers the organization's members as a link" */
    it("offers Manage organization members as a link, as main does", async () => {
      renderWithOrganizationHost(<TeamDetailScreen />, new TeamAddressHost());

      const link = await screen.findByRole("link", { name: "Manage organization members" });

      expect(link).toHaveAttribute("href", "/settings/members");
    });
  });

  describe("when the reader renames the team", () => {
    /** @scenario "Renaming a team saves the new name" */
    it("saves the new name without a save button", async () => {
      renderWithOrganizationHost(<TeamDetailScreen />, new TeamAddressHost());
      const name = await screen.findByTestId("team-form-name");

      fireEvent.input(name, { target: { value: "Renamed Team" } });
      await userEvent.type(name, "{Enter}");

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

    /** @scenario "The team settings page shows a taken name under the name field" */
    it("shows a taken name under the name field", async () => {
      const message = "A team called Taken already exists";
      updateTeam.mockImplementationOnce((_input, { onError }) =>
        onError({
          data: {
            error: {
              code: "team_name_taken",
              httpStatus: 409,
              meta: { fieldErrors: { name: message } },
            },
          },
        }),
      );
      renderWithOrganizationHost(<TeamDetailScreen />, new TeamAddressHost());
      const name = await screen.findByTestId("team-form-name");

      fireEvent.input(name, { target: { value: "Taken" } });
      await userEvent.type(name, "{Enter}");

      expect(await screen.findByText(message)).toBeVisible();
    });
  });
});
