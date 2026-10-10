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

  describe("when the server refuses the name as taken", () => {
    /** @scenario "The create-team drawer shows a taken name under the name field" */
    it("shows the message under the name field", async () => {
      const message = "A team called Platform already exists";
      mocks.create.mockImplementation((_input, { onError }) =>
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
      renderWithOrganizationHost(<CreateTeamDrawer />);

      fireEvent.change(await screen.findByTestId("team-form-name"), {
        target: { value: "Platform" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(await screen.findByText(message)).toBeVisible();
    });
  });
});
