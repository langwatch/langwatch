/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditTeamDrawer } from "../EditTeamDrawer";

// Mock dependencies
const mockPush = vi.fn();
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: mockPush,
    query: { "drawer.teamId": "team-123" },
    asPath: "/settings/teams?drawer.open=editTeam&drawer.teamId=team-123",
  }),
}));

const mockCloseDrawer = vi.fn();
const mockOpenDrawer = vi.fn();
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    canGoBack: false,
    goBack: vi.fn(),
  }),
  useDrawerParams: () => ({ teamId: "team-123" }),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => undefined,
}));

let mockMutate = vi.fn();
let mockIsLoading = false;
const mockInvalidate = vi.fn();

let mockTeamData: {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  members: Array<{
    userId: string;
    role: string;
    user: { id: string; name: string; email: string };
    assignedRole: null;
  }>;
  projects: Array<{ id: string; name: string; slug: string }>;
} = {
  id: "team-123",
  name: "Engineering",
  slug: "engineering",
  organizationId: "org-1",
  members: [
    {
      userId: "user-1",
      role: "ADMIN",
      user: { id: "user-1", name: "Alice", email: "alice@example.com" },
      assignedRole: null,
    },
  ],
  projects: [],
};

const mockOrganizationMembers = [
  { id: "user-1", name: "Alice", email: "alice@example.com" },
  { id: "user-2", name: "Bob", email: "bob@example.com" },
  { id: "user-3", name: "Charlie", email: "charlie@example.com" },
];

let mockTeamQueryLoading = false;
let mockTeamQueryError: Error | null = null;
let mockRefetch = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      team: {
        getTeamsWithMembers: {
          invalidate: mockInvalidate,
        },
      },
    }),
    team: {
      getTeamById: {
        useQuery: () => ({
          data: mockTeamQueryError ? undefined : mockTeamData,
          isLoading: mockTeamQueryLoading,
          error: mockTeamQueryError,
          refetch: mockRefetch,
        }),
      },
      update: {
        useMutation: () => ({
          mutate: mockMutate,
          isLoading: mockIsLoading,
        }),
      },
    },
    organization: {
      getAllOrganizationMembers: {
        useQuery: () => ({
          data: mockOrganizationMembers,
          isLoading: false,
        }),
      },
    },
    role: {
      getAll: {
        useQuery: () => ({
          data: [],
          isLoading: false,
        }),
      },
    },
    project: {
      archiveById: {
        useMutation: () => ({
          mutate: vi.fn(),
          isLoading: false,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: {
      user: {
        id: "current-user-id",
        name: "Current User",
        email: "current@example.com",
      },
    },
  }),
}));

let mockHasPermission = true;
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Test Org" },
    hasOrgPermission: () => true,
    hasPermission: () => mockHasPermission,
  }),
}));

// Mock toaster
const mockToasterCreate = vi.fn();
vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    create: (...args: unknown[]) => mockToasterCreate(...args),
  },
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("EditTeamDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate = vi.fn();
    mockIsLoading = false;
    mockTeamQueryLoading = false;
    mockTeamQueryError = null;
    mockRefetch = vi.fn();
    mockHasPermission = true;
    mockTeamData = {
      id: "team-123",
      name: "Engineering",
      slug: "engineering",
      organizationId: "org-1",
      members: [
        {
          userId: "user-1",
          role: "ADMIN",
          user: { id: "user-1", name: "Alice", email: "alice@example.com" },
          assignedRole: null,
        },
      ],
      projects: [],
    };
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (
    props: Partial<React.ComponentProps<typeof EditTeamDrawer>> = {},
  ) => {
    return render(<EditTeamDrawer open={true} {...props} />, {
      wrapper: Wrapper,
    });
  };

  describe("Loading state", () => {
    it("displays loading skeleton while fetching team data", async () => {
      mockTeamQueryLoading = true;
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("edit-team-loading")).toBeInTheDocument();
      });
    });

    it("hides form fields during loading", async () => {
      mockTeamQueryLoading = true;
      renderDrawer();

      await waitFor(() => {
        expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
      });
    });
  });

  describe("Error handling on fetch", () => {
    it("displays error message when team fetch fails", async () => {
      mockTeamQueryError = new Error("Network error");
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText(/failed to load team data/i)).toBeInTheDocument();
      });
    });

    it("displays retry button when fetch fails", async () => {
      mockTeamQueryError = new Error("Network error");
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
      });
    });

    it("calls refetch when retry button is clicked", async () => {
      mockTeamQueryError = new Error("Network error");
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /retry/i }));

      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe("Pre-filling form data", () => {
    it("pre-fills team name from fetched data", async () => {
      renderDrawer();

      await waitFor(() => {
        const nameInput = screen.getByLabelText(/name/i);
        expect(nameInput).toHaveValue("Engineering");
      });
    });

    it("displays team slug as read-only", async () => {
      renderDrawer();

      await waitFor(() => {
        const slugInput = screen.getByDisplayValue("engineering");
        expect(slugInput).toBeDisabled();
      });
    });

    it("shows existing members in the members list", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText(/Alice/)).toBeInTheDocument();
      });
    });
  });

  describe("Form validation", () => {
    it("prevents submission when team name is empty", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      // Clear the name field
      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      expect(mockMutate).not.toHaveBeenCalled();
    });

    it("prevents submission when team name is whitespace only", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, "   ");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      expect(mockMutate).not.toHaveBeenCalled();
    });
  });

  describe("Form submission", () => {
    it("calls update mutation on submit with team data", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, "Platform Engineering");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            teamId: "team-123",
            name: "Platform Engineering",
            members: expect.any(Array),
          }),
          expect.any(Object),
        );
      });
    });

    it("closes drawer and shows success toast on successful update", async () => {
      mockMutate.mockImplementation((_, { onSuccess }) => {
        onSuccess();
      });

      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, "Platform Engineering");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Team updated",
            type: "success",
          }),
        );
        expect(mockCloseDrawer).toHaveBeenCalled();
      });
    });

    it("invalidates teams query on successful update", async () => {
      mockMutate.mockImplementation((_, { onSuccess }) => {
        onSuccess();
      });

      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, "Platform Engineering");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(mockInvalidate).toHaveBeenCalled();
      });
    });
  });

  describe("Error handling on update", () => {
    it("shows error toast when update fails", async () => {
      const errorMessage = "Team name already exists";
      mockMutate.mockImplementation((_, { onError }) => {
        onError({ message: errorMessage });
      });

      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, "Design");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to update team",
            type: "error",
            description: errorMessage,
          }),
        );
      });
    });

    it("keeps drawer open when error occurs", async () => {
      mockMutate.mockImplementation((_, { onError }) => {
        onError({ message: "Error" });
      });

      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, "New Name");
      await user.click(screen.getByRole("button", { name: /save changes/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalled();
      });

      expect(mockCloseDrawer).not.toHaveBeenCalled();
    });
  });

  describe("Member management", () => {
    it("disables remove button when only one member exists", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Members")).toBeInTheDocument();
      });

      // Find delete buttons - they are in table cells and have red color
      const allButtons = screen.getAllByRole("button");
      const deleteButtons = allButtons.filter((btn) => {
        const hasSvg = btn.querySelector("svg") !== null;
        const hasNoText =
          !btn.textContent || btn.textContent.trim().length === 0;
        // Exclude drawer close trigger
        const isNotCloseTrigger = !btn.hasAttribute("data-part") ||
          btn.getAttribute("data-part") !== "close-trigger";
        return hasSvg && hasNoText && isNotCloseTrigger;
      });

      // The delete button for single member should be disabled
      if (deleteButtons.length > 0) {
        expect(deleteButtons[0]).toBeDisabled();
      }
    });
  });

  describe("Drawer header", () => {
    it("displays Team Settings title in edit mode", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Team Settings")).toBeInTheDocument();
      });
    });

    it("displays Save Changes button", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /save changes/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Drawer closing", () => {
    it("renders close button", async () => {
      renderDrawer();

      await waitFor(() => {
        const closeButtons = document.querySelectorAll('[aria-label="Close"]');
        expect(closeButtons.length).toBeGreaterThan(0);
      });
    });

    it("calls onClose when close button clicked without changes", async () => {
      const onClose = vi.fn();
      renderDrawer({ onClose });

      await waitFor(() => {
        expect(screen.getByText("Team Settings")).toBeInTheDocument();
      });

      const closeButtons = document.querySelectorAll('[aria-label="Close"]');
      expect(closeButtons.length).toBeGreaterThan(0);

      fireEvent.click(closeButtons[0]!);

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("closes immediately when no changes have been made", async () => {
      const onClose = vi.fn();
      renderDrawer({ onClose });

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      // Close without making any changes
      const closeButtons = document.querySelectorAll('[aria-label="Close"]');
      fireEvent.click(closeButtons[0]!);

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });

      // No discard dialog should appear
      expect(screen.queryByText(/discard unsaved changes/i)).not.toBeInTheDocument();
    });
  });

  describe("Unsaved changes confirmation dialog", () => {
    it("shows discard dialog when closing with unsaved changes", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      // Make a change to trigger dirty state
      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, "Modified Team Name");

      // Try to close the drawer
      const closeButtons = document.querySelectorAll('[aria-label="Close"]');
      fireEvent.click(closeButtons[0]!);

      // Discard dialog should appear
      await waitFor(() => {
        expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
      });
    });

    it("confirms discard and closes drawer without saving", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderDrawer({ onClose });

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      // Make a change
      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, "Modified Team Name");

      // Try to close
      const closeButtons = document.querySelectorAll('[aria-label="Close"]');
      fireEvent.click(closeButtons[0]!);

      // Wait for discard dialog
      await waitFor(() => {
        expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
      });

      // Click "Discard Changes" button
      const discardButton = screen.getByRole("button", { name: /discard changes/i });
      await user.click(discardButton);

      // Drawer should close without saving
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
      expect(mockMutate).not.toHaveBeenCalled();
    });

    it("cancels discard and keeps drawer open with changes preserved", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderDrawer({ onClose });

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      // Make a change
      const nameInput = screen.getByLabelText(/name/i);
      await user.clear(nameInput);
      await user.type(nameInput, "Modified Team Name");

      // Try to close
      const closeButtons = document.querySelectorAll('[aria-label="Close"]');
      fireEvent.click(closeButtons[0]!);

      // Wait for discard dialog
      await waitFor(() => {
        expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
      });

      // Click "Continue Editing" button
      const continueButton = screen.getByRole("button", { name: /continue editing/i });
      await user.click(continueButton);

      // Drawer should remain open
      expect(onClose).not.toHaveBeenCalled();

      // Changes should be preserved
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toHaveValue("Modified Team Name");
      });
    });
  });
});
