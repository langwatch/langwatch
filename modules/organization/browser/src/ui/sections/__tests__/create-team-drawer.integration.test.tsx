/**
 * @vitest-environment jsdom
 * Create New Team with a blank name says so on the field and sends nothing (WEB-5602), as on main.
 * @see specs/team-settings.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("../../../behavior/organization-api.ts", () => {
  const refresh = { invalidate: () => Promise.resolve(), refetch: () => Promise.resolve() };
  return {
    api: {
      useUtils: () => ({
        team: { getTeamsWithGrants: refresh },
        organization: { getDirectoryCounts: refresh, getScopeGraph: refresh },
      }),
      team: {
        createTeamWithMembers: { useMutation: () => ({ mutate: mocks.create, isPending: false }) },
      },
      role: { getAll: { useQuery: () => ({ data: [] }) } },
      project: { archiveById: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
      organization: {
        getAllOrganizationMembers: { useQuery: () => ({ data: [] }) },
      },
    },
  };
});

import { renderWithOrganizationHost } from "../../../testing.tsx";
import { CreateTeamDrawer } from "../create-team-drawer.tsx";

describe("given the Create New Team drawer", () => {
  afterEach(() => {
    cleanup();
    mocks.create.mockReset();
  });

  describe("when Create is pressed with the name left blank", () => {
    /** @scenario "A blank team name is refused on the field" */
    it("shows that the name is required and sends nothing", async () => {
      renderWithOrganizationHost(<CreateTeamDrawer />);

      fireEvent.click(await screen.findByRole("button", { name: "Create" }));

      expect(await screen.findByText("Name is required")).toBeVisible();
      expect(mocks.create).not.toHaveBeenCalled();
    });
  });
});
