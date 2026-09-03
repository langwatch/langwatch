/**
 * @vitest-environment jsdom
 *
 * The drawer that creates a project, mounted the way the registry mounts it.
 *
 * NEW WITH THE RECOVERY. `platform/app` shipped this drawer with a validation
 * unit test and nothing that rendered it, and the spec says so in a note: "The
 * CreateProjectDrawer page-render flows have no JSDOM render fixture exercising
 * them today. Cheap follow-up: write a JSDOM render test." This is that test,
 * written while the drawer was being put back rather than left as a note.
 *
 * WHAT IT PINS is the half a validation test cannot see: that the drawer opens
 * at all, that the name and the team reach `project.create` as the customer
 * typed them, and that a rejected create is shown INLINE rather than as a toast
 * — which is the whole reason the mutation has no `onError`.
 *
 * @see specs/projects/create-project-drawer.feature
 * @see specs/projects/project-creation-flow.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { mockCreate, mockCreateState, mockTeams, invalidations, mockEmit } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockCreateState: { current: { isPending: false, error: null as unknown } },
  mockTeams: {
    current: [
      {
        id: "team-1",
        name: "Engineering",
        slug: "engineering",
        isPersonal: false,
        projects: [{ id: "proj-1" }],
      },
      { id: "team-2", name: "Data", slug: "data", isPersonal: false, projects: [] },
    ] as Array<Record<string, unknown>>,
  },
  invalidations: { current: [] as string[] },
  mockEmit: vi.fn(),
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
      limits: { getUsage: invalidator("limits.getUsage") },
      team: {
        getTeamsWithMembers: invalidator("team.getTeamsWithMembers"),
        getTeamWithMembers: invalidator("team.getTeamWithMembers"),
        getTeamsWithRoleBindings: invalidator("team.getTeamsWithRoleBindings"),
      },
    }),
    team: {
      getTeamsWithMembers: { useQuery: () => ({ data: mockTeams.current }) },
    },
    project: {
      create: {
        useMutation: () => ({
          mutate: mockCreate,
          isPending: mockCreateState.current.isPending,
          error: mockCreateState.current.error,
        }),
      },
    },
  },
}));

vi.mock("react-contextual-analytics", () => ({
  useAnalytics: () => ({ emit: mockEmit }),
}));

import { CreateProjectDrawer } from "../create-project-drawer";
import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing";

const typeName = async (name: string) => {
  const user = userEvent.setup();
  const input = await screen.findByPlaceholderText("AI Project");
  await user.clear(input);
  await user.type(input, name);
  return user;
};

describe("given the create-project drawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidations.current = [];
    mockCreateState.current = { isPending: false, error: null };
  });

  afterEach(() => {
    cleanup();
  });

  describe("when it opens", () => {
    /** @scenario "Drawer displays all form fields" */
    it("shows the title, the name field and the submit", async () => {
      renderWithOrganizationHost(<CreateProjectDrawer />);

      expect(await screen.findByText("Create New Project")).toBeInTheDocument();
      expect(screen.getByText("Project Name")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    });
  });

  describe("when the form is submitted with a name and the caller's default team", () => {
    /** @scenario "Create project with all required fields" */
    it("sends both to project.create against the organization in scope", async () => {
      renderWithOrganizationHost(<CreateProjectDrawer defaultTeamId="team-2" />);

      const user = await typeName("Checkout Bot");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalled());
      expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({
        organizationId: "org-1",
        name: "Checkout Bot",
        teamId: "team-2",
      });
    });

    /** @scenario "Project creation calls correct API endpoint" */
    it("refreshes every list the new project has to appear in", async () => {
      renderWithOrganizationHost(<CreateProjectDrawer defaultTeamId="team-2" />);

      const user = await typeName("Checkout Bot");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalled());
      mockCreate.mock.calls[0]?.[1]?.onSuccess?.({ projectSlug: "checkout-bot" });

      expect(invalidations.current).toEqual([
        "organization.getAll",
        "limits.getUsage",
        "team.getTeamsWithMembers",
        "team.getTeamWithMembers",
        "team.getTeamsWithRoleBindings",
      ]);
    });

    /** @scenario "Optional redirect to new project" */
    it("navigates to the new project only when the caller asked for it", async () => {
      const { host } = renderWithOrganizationHost(
        <CreateProjectDrawer defaultTeamId="team-2" navigateOnCreate />,
        new FakeOrganizationHost(),
      );

      const user = await typeName("Checkout Bot");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalled());
      mockCreate.mock.calls[0]?.[1]?.onSuccess?.({ projectSlug: "checkout-bot" });

      expect(host.navigations).toEqual(["/checkout-bot"]);
    });

    /** @scenario "Stay on current page when no redirect configured" */
    it("stays put and closes when it was not", async () => {
      const { host } = renderWithOrganizationHost(
        <CreateProjectDrawer defaultTeamId="team-2" />,
        new FakeOrganizationHost(),
      );

      const user = await typeName("Checkout Bot");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalled());
      mockCreate.mock.calls[0]?.[1]?.onSuccess?.({ projectSlug: "checkout-bot" });

      expect(host.navigations).toEqual([]);
      expect(host.overlays).toContainEqual({ name: null });
    });

    /** @scenario "Track project creation event" */
    it("records the creation as a product event", async () => {
      renderWithOrganizationHost(<CreateProjectDrawer defaultTeamId="team-2" />);

      const user = await typeName("Checkout Bot");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalled());
      mockCreate.mock.calls[0]?.[1]?.onSuccess?.({ projectSlug: "checkout-bot" });

      expect(mockEmit).toHaveBeenCalledWith(
        "created",
        "project",
        expect.objectContaining({ project_slug: "checkout-bot" }),
      );
    });
  });

  describe("when the name is left empty", () => {
    /** @scenario "Project name is required" */
    it("refuses to submit and says why on the field", async () => {
      const user = userEvent.setup();
      renderWithOrganizationHost(<CreateProjectDrawer defaultTeamId="team-2" />);

      await screen.findByPlaceholderText("AI Project");
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(await screen.findByText("Project name is required")).toBeInTheDocument();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("when the server rejects the create", () => {
    /**
     * The rejection is a state that is still true rather than a moment that has
     * passed, which is why the mutation has no `onError` and the form carries
     * the alert instead. A toast here would scroll away from a form the reader
     * is still looking at.
     */
    /** @scenario "Handle API error gracefully" */
    it("says so inline rather than as a toast", async () => {
      mockCreateState.current = {
        isPending: false,
        error: { data: { error: { code: "validation_error", httpStatus: 400, meta: {} } } },
      };

      const { host } = renderWithOrganizationHost(
        <CreateProjectDrawer defaultTeamId="team-2" />,
        new FakeOrganizationHost(),
      );

      expect(await screen.findByText("Couldn't save this project")).toBeInTheDocument();
      expect(host.failures).toEqual([]);
    });

    /** @scenario "Handle duplicate project name error" */
    it("puts a field-level refusal on the field the server named", async () => {
      mockCreateState.current = {
        isPending: false,
        error: {
          data: {
            error: {
              code: "validation_error",
              httpStatus: 400,
              meta: { fieldErrors: { name: "A project by that name already exists" } },
            },
          },
        },
      };

      renderWithOrganizationHost(<CreateProjectDrawer defaultTeamId="team-2" />);

      expect(await screen.findByText("A project by that name already exists")).toBeInTheDocument();
      expect(screen.queryByText("Couldn't save this project")).not.toBeInTheDocument();
    });
  });
});
