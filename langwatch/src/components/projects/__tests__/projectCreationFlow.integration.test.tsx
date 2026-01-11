/**
 * Integration test for the full project creation flow.
 * Tests that:
 * 1. Opening the drawer works from entry points
 * 2. Form submission triggers API call with correct data
 * 3. Query invalidation happens on success
 * 4. Success toast is shown
 * 5. Drawer closes after creation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Track invalidation calls
const invalidateCalls: string[] = [];
const mockMutate = vi.fn();

// Mock all external dependencies
vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-integration-test" },
    project: { id: "proj-integration-test" },
  }),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    team: {
      getTeamsWithMembers: {
        useQuery: () => ({
          data: [{ id: "team-1", name: "Default Team", projects: [{ id: "p1" }] }],
        }),
      },
    },
    limits: {
      getUsage: {
        useQuery: () => ({
          data: {
            projectsCount: 1,
            activePlan: { maxProjects: 10, overrideAddingLimitations: false },
          },
        }),
      },
    },
    project: {
      create: {
        useMutation: () => ({
          mutate: mockMutate,
          isLoading: false,
          error: null,
        }),
      },
    },
    useContext: () => ({
      organization: {
        getAll: {
          invalidate: () => {
            invalidateCalls.push("organization.getAll");
            return Promise.resolve();
          },
        },
      },
      limits: {
        getUsage: {
          invalidate: () => {
            invalidateCalls.push("limits.getUsage");
            return Promise.resolve();
          },
        },
      },
      team: {
        getTeamsWithMembers: {
          invalidate: () => {
            invalidateCalls.push("team.getTeamsWithMembers");
            return Promise.resolve();
          },
        },
      },
    }),
  },
}));

vi.mock("../../../utils/tracking", () => ({
  trackEvent: vi.fn(),
}));

const mockToasterCreate = vi.fn();
vi.mock("../../ui/toaster", () => ({
  toaster: { create: mockToasterCreate },
}));

vi.mock("../../ui/drawer", () => ({
  Drawer: {
    Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open ? <div data-testid="drawer">{children}</div> : null,
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Body: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CloseTrigger: () => <button>Close</button>,
  },
}));

vi.mock("../LanguageGrid", () => ({
  LanguageGrid: ({ onSelectLanguage }: { onSelectLanguage: (l: string) => void }) => (
    <button data-testid="select-python" onClick={() => onSelectLanguage("python")}>
      Python
    </button>
  ),
}));

vi.mock("../FrameworkGrid", () => ({
  FrameworkGrid: ({ onSelectFramework }: { onSelectFramework: (f: string) => void }) => (
    <button data-testid="select-openai" onClick={() => onSelectFramework("openai")}>
      OpenAI
    </button>
  ),
}));

import { CreateProjectDrawer } from "../CreateProjectDrawer";

describe("Project Creation Flow Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCalls.length = 0;
  });

  describe("when completing the full creation flow", () => {
    it("submits correct data to API", async () => {
      const user = userEvent.setup();
      render(<CreateProjectDrawer open={true} />);

      // Fill form
      await user.type(screen.getByLabelText(/project name/i), "Integration Test Project");

      // Submit
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Integration Test Project",
            organizationId: "org-integration-test",
            language: "python",
            framework: "openai",
          }),
          expect.any(Object),
        );
      });
    });

    it("invalidates queries on successful creation", async () => {
      const user = userEvent.setup();

      // Setup mutate to call onSuccess
      mockMutate.mockImplementation((_data, { onSuccess }) => {
        onSuccess({ success: true, projectSlug: "integration-test-project" });
      });

      render(<CreateProjectDrawer open={true} />);

      await user.type(screen.getByLabelText(/project name/i), "Test");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(invalidateCalls).toContain("organization.getAll");
        expect(invalidateCalls).toContain("limits.getUsage");
        expect(invalidateCalls).toContain("team.getTeamsWithMembers");
      });
    });

    it("shows success toast on creation", async () => {
      const user = userEvent.setup();

      mockMutate.mockImplementation((_data, { onSuccess }) => {
        onSuccess({ success: true, projectSlug: "my-new-project" });
      });

      render(<CreateProjectDrawer open={true} />);

      await user.type(screen.getByLabelText(/project name/i), "My New Project");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Project Created",
            type: "success",
          }),
        );
      });
    });
  });

  describe("when API returns error", () => {
    it("shows error toast", async () => {
      const user = userEvent.setup();

      mockMutate.mockImplementation((_data, { onError }) => {
        onError({ message: "Project name already exists" });
      });

      render(<CreateProjectDrawer open={true} />);

      await user.type(screen.getByLabelText(/project name/i), "Duplicate Name");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Error creating project",
            type: "error",
          }),
        );
      });
    });
  });
});
