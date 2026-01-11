/**
 * RTL integration test for ProjectForm component.
 * Tests the full form flow with minimal mocking.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock hooks and API
vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-test" },
    project: { id: "proj-test" },
  }),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    team: {
      getTeamsWithMembers: {
        useQuery: () => ({
          data: [
            { id: "team-1", name: "Team One", projects: [{ id: "p1" }] },
            { id: "team-2", name: "Team Two", projects: [] },
          ],
        }),
      },
    },
    limits: {
      getUsage: {
        useQuery: () => ({
          data: {
            projectsCount: 2,
            activePlan: { maxProjects: 10, overrideAddingLimitations: false },
          },
        }),
      },
    },
  },
}));

vi.mock("../../../utils/tracking", () => ({
  trackEvent: vi.fn(),
}));

// Mock grid components
vi.mock("../LanguageGrid", () => ({
  LanguageGrid: ({
    selectedLanguage,
    onSelectLanguage,
  }: {
    selectedLanguage: string;
    onSelectLanguage: (l: string) => void;
  }) => (
    <div data-testid="language-grid">
      <button
        data-testid="select-python"
        aria-pressed={selectedLanguage === "python"}
        onClick={() => onSelectLanguage("python")}
      >
        Python
      </button>
      <button
        data-testid="select-typescript"
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
    onSelectFramework: (f: string) => void;
  }) => (
    <div data-testid="framework-grid">
      <button
        data-testid="select-openai"
        aria-pressed={selectedFramework === "openai"}
        onClick={() => onSelectFramework("openai")}
      >
        OpenAI
      </button>
    </div>
  ),
}));

import { ProjectForm } from "../ProjectForm";

describe("ProjectForm", () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when rendering the form", () => {
    it("displays project name input", () => {
      render(<ProjectForm onSubmit={mockOnSubmit} />);
      expect(screen.getByLabelText(/project name/i)).toBeInTheDocument();
    });

    it("displays language grid", () => {
      render(<ProjectForm onSubmit={mockOnSubmit} />);
      expect(screen.getByTestId("language-grid")).toBeInTheDocument();
    });

    it("displays framework grid", () => {
      render(<ProjectForm onSubmit={mockOnSubmit} />);
      expect(screen.getByTestId("framework-grid")).toBeInTheDocument();
    });

    it("displays create button", () => {
      render(<ProjectForm onSubmit={mockOnSubmit} />);
      expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
    });
  });

  describe("when submitting with valid data", () => {
    it("calls onSubmit with form data", async () => {
      const user = userEvent.setup();
      render(<ProjectForm onSubmit={mockOnSubmit} />);

      await user.type(screen.getByLabelText(/project name/i), "Test Project");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Test Project",
            language: "python",
            framework: "openai",
          }),
        );
      });
    });
  });

  describe("when selecting a different language", () => {
    it("updates the selection", async () => {
      const user = userEvent.setup();
      render(<ProjectForm onSubmit={mockOnSubmit} />);

      await user.click(screen.getByTestId("select-typescript"));
      await user.type(screen.getByLabelText(/project name/i), "TS Project");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(
          expect.objectContaining({
            language: "typescript",
          }),
        );
      });
    });
  });

  describe("when loading", () => {
    it("disables the submit button", () => {
      render(<ProjectForm onSubmit={mockOnSubmit} isLoading={true} />);

      const button = screen.getByRole("button", { name: /create/i });
      expect(button).toBeDisabled();
    });
  });

  describe("when there is an error", () => {
    it("displays the error message", () => {
      render(
        <ProjectForm onSubmit={mockOnSubmit} error="Something went wrong" />,
      );

      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });
});
