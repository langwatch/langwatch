/**
 * @vitest-environment jsdom
 *
 * Integration test for project creation flow.
 * Tests the core behavior: form submission triggers API call with correct payload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Use vi.hoisted to define mocks before vi.mock hoisting
const { mockMutate, mockToasterCreate, mockRouterPush } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockToasterCreate: vi.fn(),
  mockRouterPush: vi.fn(),
}));

// Mock next/router
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

// Mock Chakra UI primitives used in CreateProjectDrawer
vi.mock("@chakra-ui/react", () => ({
  HStack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-test-123" },
  }),
}));

vi.mock("../../../utils/api", () => ({
  api: {
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
      organization: { getAll: { invalidate: vi.fn() } },
      limits: { getUsage: { invalidate: vi.fn() } },
      team: { getTeamsWithMembers: { invalidate: vi.fn() } },
    }),
  },
}));

vi.mock("../../../utils/tracking", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../ui/toaster", () => ({
  toaster: { create: mockToasterCreate },
}));

// Minimal drawer mock - just renders children when open
vi.mock("../../ui/drawer", () => ({
  Drawer: {
    Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open ? <div data-testid="drawer">{children}</div> : null,
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Body: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    CloseTrigger: () => null,
  },
}));

// Mock ProjectForm to directly test CreateProjectDrawer's onSubmit handling
vi.mock("../ProjectForm", () => ({
  ProjectForm: ({
    onSubmit,
    isLoading,
  }: {
    onSubmit: (data: Record<string, unknown>) => void;
    isLoading: boolean;
  }) => (
    <form
      data-testid="project-form"
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        onSubmit({
          name: formData.get("name") as string,
          teamId: "team-1",
          language: "python",
          framework: "openai",
        });
      }}
    >
      <input name="name" aria-label="Project name" defaultValue="" />
      <button type="submit" disabled={isLoading}>
        Create
      </button>
    </form>
  ),
}));

import { CreateProjectDrawer } from "../CreateProjectDrawer";

describe("Project Creation Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when submitting the form", () => {
    it("calls API with correct payload", async () => {
      const user = userEvent.setup();
      render(<CreateProjectDrawer open={true} />);

      await user.type(screen.getByLabelText(/project name/i), "My New Project");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          {
            organizationId: "org-test-123",
            name: "My New Project",
            teamId: "team-1",
            newTeamName: undefined,
            language: "python",
            framework: "openai",
          },
          expect.any(Object),
        );
      });
    });
  });

  describe("when API succeeds", () => {
    it("shows success toast", async () => {
      const user = userEvent.setup();
      mockMutate.mockImplementation((_data, { onSuccess }) => {
        onSuccess({ projectSlug: "my-new-project" });
      });

      render(<CreateProjectDrawer open={true} />);

      await user.type(screen.getByLabelText(/project name/i), "Test");
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

  describe("when API fails", () => {
    it("shows error toast", async () => {
      const user = userEvent.setup();
      mockMutate.mockImplementation((_data, { onError }) => {
        onError({ message: "Project name already exists" });
      });

      render(<CreateProjectDrawer open={true} />);

      await user.type(screen.getByLabelText(/project name/i), "Duplicate");
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

  describe("when navigateOnCreate is true", () => {
    it("navigates to the new project after creation", async () => {
      const user = userEvent.setup();
      mockMutate.mockImplementation((_data, { onSuccess }) => {
        onSuccess({ projectSlug: "my-new-project" });
      });

      render(<CreateProjectDrawer open={true} navigateOnCreate={true} />);

      await user.type(screen.getByLabelText(/project name/i), "Test");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalledWith("/my-new-project");
      });
    });
  });
});
