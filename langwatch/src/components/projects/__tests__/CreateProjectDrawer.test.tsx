import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing component
const mockOpenDrawer = vi.fn();
const mockCloseDrawer = vi.fn();
const mockMutate = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: mockCloseDrawer,
  }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-123", name: "Test Org" },
    project: { id: "proj-123" },
  }),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    team: {
      getTeamsWithMembers: {
        useQuery: () => ({
          data: [
            { id: "team-1", name: "Engineering", projects: [{ id: "p1" }] },
            { id: "team-2", name: "Data Science", projects: [] },
          ],
        }),
      },
    },
    limits: {
      getUsage: {
        useQuery: () => ({
          data: {
            projectsCount: 2,
            activePlan: {
              maxProjects: 10,
              overrideAddingLimitations: false,
            },
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
      organization: { getAll: { invalidate: mockInvalidate } },
      limits: { getUsage: { invalidate: mockInvalidate } },
      team: { getTeamsWithMembers: { invalidate: mockInvalidate } },
    }),
  },
}));

vi.mock("../../../utils/tracking", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("../../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// Mock Chakra UI Drawer components
vi.mock("../../ui/drawer", () => ({
  Drawer: {
    Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open ? <div data-testid="drawer">{children}</div> : null,
    Content: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="drawer-content">{children}</div>
    ),
    Header: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="drawer-header">{children}</div>
    ),
    Body: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="drawer-body">{children}</div>
    ),
    CloseTrigger: ({ onClick }: { onClick?: () => void }) => (
      <button data-testid="close-button" onClick={onClick}>
        Close
      </button>
    ),
  },
}));

// Mock grid components for simplicity
vi.mock("../LanguageGrid", () => ({
  LanguageGrid: ({
    selectedLanguage,
    onSelectLanguage,
  }: {
    selectedLanguage: string;
    onSelectLanguage: (lang: string) => void;
  }) => (
    <div data-testid="language-grid">
      <button
        data-testid="lang-python"
        aria-pressed={selectedLanguage === "python"}
        onClick={() => onSelectLanguage("python")}
      >
        Python
      </button>
      <button
        data-testid="lang-typescript"
        aria-pressed={selectedLanguage === "typescript"}
        onClick={() => onSelectLanguage("typescript")}
      >
        TypeScript
      </button>
    </div>
  ),
}));

vi.mock("../FrameworkGrid", () => ({
  FrameworkGrid: ({
    selectedFramework,
    onSelectFramework,
  }: {
    selectedFramework: string;
    onSelectFramework: (fw: string) => void;
  }) => (
    <div data-testid="framework-grid">
      <button
        data-testid="fw-openai"
        aria-pressed={selectedFramework === "openai"}
        onClick={() => onSelectFramework("openai")}
      >
        OpenAI
      </button>
      <button
        data-testid="fw-langchain"
        aria-pressed={selectedFramework === "langchain"}
        onClick={() => onSelectFramework("langchain")}
      >
        LangChain
      </button>
    </div>
  ),
}));

import { CreateProjectDrawer } from "../CreateProjectDrawer";

describe("CreateProjectDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when opened", () => {
    it("displays the drawer with form fields", () => {
      render(<CreateProjectDrawer open={true} />);

      expect(screen.getByTestId("drawer")).toBeInTheDocument();
      expect(screen.getByLabelText(/project name/i)).toBeInTheDocument();
      expect(screen.getByTestId("language-grid")).toBeInTheDocument();
      expect(screen.getByTestId("framework-grid")).toBeInTheDocument();
    });

    it("displays the title", () => {
      render(<CreateProjectDrawer open={true} />);

      expect(screen.getByText("Create New Project")).toBeInTheDocument();
    });
  });

  describe("when closed", () => {
    it("does not render the drawer", () => {
      render(<CreateProjectDrawer open={false} />);

      expect(screen.queryByTestId("drawer")).not.toBeInTheDocument();
    });
  });

  describe("when submitting the form", () => {
    it("calls the create mutation with form data", async () => {
      const user = userEvent.setup();
      render(<CreateProjectDrawer open={true} />);

      // Fill in project name
      const nameInput = screen.getByLabelText(/project name/i);
      await user.type(nameInput, "My New Project");

      // Select TypeScript
      await user.click(screen.getByTestId("lang-typescript"));

      // Select LangChain
      await user.click(screen.getByTestId("fw-langchain"));

      // Submit
      const submitButton = screen.getByRole("button", { name: /create/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "My New Project",
            organizationId: "org-123",
            language: "typescript",
            framework: "langchain",
          }),
          expect.any(Object),
        );
      });
    });
  });

  describe("when clicking close button", () => {
    it("calls closeDrawer", async () => {
      const user = userEvent.setup();
      render(<CreateProjectDrawer open={true} />);

      await user.click(screen.getByTestId("close-button"));

      expect(mockCloseDrawer).toHaveBeenCalled();
    });
  });

  describe("when team selector is visible", () => {
    it("shows team options when there are teams with projects", () => {
      render(<CreateProjectDrawer open={true} />);

      // Team selector should be visible because Engineering has projects
      expect(screen.getByLabelText(/team/i)).toBeInTheDocument();
    });
  });
});
