/**
 * @vitest-environment jsdom
 *
 * Create-project drawer: opens, sends name/team, shows errors inline.
 * @see specs/projects/create-project-drawer.feature
 * @see specs/projects/project-creation-flow.feature
 */

import { UiAnalytics, type UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

class RecordingUiAnalytics extends UiAnalytics {
  readonly tracked: UiAnalyticsEvent[] = [];

  track(event: UiAnalyticsEvent): void {
    this.tracked.push(event);
  }

  identify(): void {}

  group(): void {}

  reset(): void {}
}

const { mockCreate, mockCreateState, mockTeams, invalidations } = vi.hoisted(() => ({
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
    ] as Record<string, unknown>[],
  },
  invalidations: { current: [] as string[] },
}));

const invalidator = (name: string) => ({
  invalidate: () => {
    invalidations.current.push(name);
    return Promise.resolve();
  },
});

vi.mock("../../../behavior/organization-api.ts", () => ({
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

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing.tsx";
import { CreateProjectDrawer } from "../create-project-drawer.tsx";

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
      const analytics = new RecordingUiAnalytics();
      renderWithOrganizationHost(
        <CreateProjectDrawer defaultTeamId="team-2" />,
        new FakeOrganizationHost(),
        { analytics },
      );

      const user = await typeName("Checkout Bot");
      await user.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => expect(mockCreate).toHaveBeenCalled());
      mockCreate.mock.calls[0]?.[1]?.onSuccess?.({
        projectSlug: "checkout-bot",
      });

      expect(analytics.tracked).toEqual([
        {
          action: "created",
          name: "project",
          attributes: {
            project_slug: "checkout-bot",
            language: "other",
            framework: "other",
          },
        },
      ]);
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
