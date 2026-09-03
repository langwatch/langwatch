/**
 * @vitest-environment jsdom
 *
 * The drawer that renames a project or moves it to another team.
 *
 * NEW WITH THE RECOVERY, like its create-side sibling: `platform/app` shipped
 * this drawer with no test that rendered it, and the spec's UI half is a block
 * of `@unimplemented` scenarios saying exactly that.
 *
 * WHAT IT PINS is the property a REST-level test cannot see: only the fields
 * the reader actually changed are sent. `project.update` is the same procedure
 * that saves the whole project-settings page, so a drawer that posted its
 * untouched fields back would overwrite settings it never showed anybody.
 *
 * @see specs/projects/edit-project-team.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { mockUpdate, invalidations } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  invalidations: { current: [] as string[] },
}));

const invalidator = (name: string) => ({
  invalidate: () => {
    invalidations.current.push(name);
    return Promise.resolve();
  },
});

vi.mock("../../../behavior/organization-api", () => ({
  api: {
    useUtils: () => ({
      organization: { getAll: invalidator("organization.getAll") },
      team: {
        getTeamsWithMembers: invalidator("team.getTeamsWithMembers"),
        getTeamsWithRoleBindings: invalidator("team.getTeamsWithRoleBindings"),
      },
    }),
    team: {
      getTeamsWithMembers: {
        useQuery: () => ({
          data: [
            {
              id: "team-1",
              name: "Engineering",
              slug: "engineering",
              isPersonal: false,
              projects: [],
            },
            { id: "team-2", name: "Analytics", slug: "analytics", isPersonal: false, projects: [] },
            { id: "team-3", name: "Ada", slug: "ada", isPersonal: true, projects: [] },
          ],
        }),
      },
    },
    project: {
      update: { useMutation: () => ({ mutate: mockUpdate, isPending: false }) },
    },
  },
}));

import { EditProjectDrawer } from "../edit-project-drawer";
import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing";

const OPEN_FOR_MY_CHATBOT = (
  <EditProjectDrawer projectId="proj-1" projectName="My Chatbot" currentTeamId="team-1" />
);

describe("given the edit-project drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidations.current = [];
  });

  afterEach(() => {
    cleanup();
  });

  describe("when it opens for a project", () => {
    /** @scenario "Edit button opens project edit drawer" */
    it("shows the project's current name and its current team", async () => {
      renderWithOrganizationHost(OPEN_FOR_MY_CHATBOT);

      expect(await screen.findByText("Edit Project")).toBeInTheDocument();
      expect(await screen.findByDisplayValue("My Chatbot")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toHaveTextContent("Engineering");
    });

    /**
     * A personal workspace holds only the project provisioned with it, and the
     * server refuses the move. Leaving it in the picker would make the refusal
     * the way the reader finds that out.
     */
    /** @scenario "Team selector only shows non-archived teams in same org" */
    it("does not offer a personal workspace as somewhere to move it", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithOrganizationHost(OPEN_FOR_MY_CHATBOT);

      await screen.findByDisplayValue("My Chatbot");
      await user.click(screen.getByRole("combobox"));

      expect(
        await screen.findAllByRole("option", { name: "Analytics", hidden: true }),
      ).not.toHaveLength(0);
      expect(screen.queryAllByRole("option", { name: "Ada", hidden: true })).toHaveLength(0);
    });

    it("keeps Save disabled until something actually changes", async () => {
      renderWithOrganizationHost(OPEN_FOR_MY_CHATBOT);

      await screen.findByDisplayValue("My Chatbot");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });

  describe("when only the name is changed", () => {
    /** @scenario "User updates project name via drawer" */
    it("sends the new name and leaves the team out of the call", async () => {
      const user = userEvent.setup();
      renderWithOrganizationHost(OPEN_FOR_MY_CHATBOT);

      const input = await screen.findByDisplayValue("My Chatbot");
      await user.clear(input);
      await user.type(input, "Renamed Bot");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(mockUpdate.mock.calls[0]?.[0]).toEqual({
        projectId: "proj-1",
        name: "Renamed Bot",
      });
    });

    /** @scenario "User updates project name via drawer" */
    it("closes and refreshes the lists once the save lands", async () => {
      const user = userEvent.setup();
      const { host } = renderWithOrganizationHost(OPEN_FOR_MY_CHATBOT, new FakeOrganizationHost());

      const input = await screen.findByDisplayValue("My Chatbot");
      await user.clear(input);
      await user.type(input, "Renamed Bot");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      mockUpdate.mock.calls[0]?.[1]?.onSuccess?.();

      expect(host.successes.map((notice) => notice.title)).toContain("Project updated");
      expect(host.overlays).toContainEqual({ name: null });
      expect(invalidations.current).toContain("team.getTeamsWithMembers");
    });
  });

  describe("when the project is moved to another team", () => {
    /** @scenario "User moves project to different team via drawer" */
    it("sends the new team and leaves the unchanged name out of the call", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithOrganizationHost(OPEN_FOR_MY_CHATBOT);

      await screen.findByDisplayValue("My Chatbot");
      await user.click(screen.getByRole("combobox"));
      const analytics = await screen.findAllByRole("option", {
        name: "Analytics",
        hidden: true,
      });
      await user.click(analytics.find((option) => option.tagName === "DIV")!);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
      expect(mockUpdate.mock.calls[0]?.[0]).toEqual({
        projectId: "proj-1",
        teamId: "team-2",
      });
    });
  });
});
