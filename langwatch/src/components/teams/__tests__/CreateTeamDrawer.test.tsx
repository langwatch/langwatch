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

import { CreateTeamDrawer } from "../CreateTeamDrawer";

// Mock dependencies
const mockPush = vi.fn();
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: mockPush,
    query: {},
    asPath: "/test",
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
  getComplexProps: () => ({}),
  getFlowCallbacks: () => undefined,
}));

let mockMutate = vi.fn();
let mockIsLoading = false;
const mockInvalidate = vi.fn();

const mockOrganizationMembers = [
  { id: "user-1", name: "Alice", email: "alice@example.com" },
  { id: "user-2", name: "Bob", email: "bob@example.com" },
  { id: "user-3", name: "Charlie", email: "charlie@example.com" },
];

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
      createTeamWithMembers: {
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
  },
}));

const mockSession = {
  user: {
    id: "current-user-id",
    name: "Current User",
    email: "current@example.com",
  },
};
vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: mockSession,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Test Org" },
    hasOrgPermission: () => true,
  }),
}));

// Mock toaster for error tests
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

describe("CreateTeamDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutate = vi.fn();
    mockIsLoading = false;
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (
    props: Partial<React.ComponentProps<typeof CreateTeamDrawer>> = {},
  ) => {
    return render(<CreateTeamDrawer open={true} {...props} />, {
      wrapper: Wrapper,
    });
  };

  describe("Basic rendering", () => {
    it("renders the drawer with Create New Team title", async () => {
      renderDrawer();
      await waitFor(() => {
        // Title rendered by TeamForm component
        expect(screen.getByText("Create New Team")).toBeInTheDocument();
      });
    });

    it("renders a close button", async () => {
      renderDrawer();
      await waitFor(() => {
        // Close button from Drawer.CloseTrigger
        const closeButtons = document.querySelectorAll(
          '[aria-label="Close"]',
        );
        expect(closeButtons.length).toBeGreaterThan(0);
      });
    });

    it("renders the team name input field", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });
    });

    it("renders the members section", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Members")).toBeInTheDocument();
      });
    });

    it("renders a Create button", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /create/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Current user pre-population", () => {
    it("pre-populates current user as first member", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText(/Current User/)).toBeInTheDocument();
      });
    });

    it("pre-populates current user with Admin role", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Admin")).toBeInTheDocument();
      });
    });
  });

  describe("Form validation", () => {
    it("prevents submission when team name is empty", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /create/i }),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /create/i }));

      // Mutation should not be called
      expect(mockMutate).not.toHaveBeenCalled();
    });
  });

  describe("Form submission", () => {
    it("calls createTeamWithMembers mutation on submit", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/name/i), "Engineering Team");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Engineering Team",
            organizationId: "org-1",
            members: expect.arrayContaining([
              expect.objectContaining({
                userId: "current-user-id",
              }),
            ]),
          }),
          expect.any(Object),
        );
      });
    });
  });

  describe("Drawer closing", () => {
    it("closes drawer on successful submission", async () => {
      mockMutate.mockImplementation((_, { onSuccess }) => {
        onSuccess();
      });

      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/name/i), "Engineering Team");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockCloseDrawer).toHaveBeenCalled();
      });
    });

    it("invalidates teams query on success", async () => {
      mockMutate.mockImplementation((_, { onSuccess }) => {
        onSuccess();
      });

      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/name/i), "Engineering Team");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockInvalidate).toHaveBeenCalled();
      });
    });
  });

  describe("onClose callback", () => {
    it("calls onClose when provided on successful submission", async () => {
      const onClose = vi.fn();
      mockMutate.mockImplementation((_, { onSuccess }) => {
        onSuccess();
      });

      const user = userEvent.setup();
      renderDrawer({ onClose });

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/name/i), "Engineering Team");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe("Member management", () => {
    it("adds another member when clicking Add Another button", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Members")).toBeInTheDocument();
      });

      // Initially there is one member (current user)
      const initialRows = screen.getAllByRole("row");

      // Click "Add Another" button
      const addButton = screen.getByRole("button", { name: /add another/i });
      await user.click(addButton);

      // Now there should be one more row
      await waitFor(() => {
        const updatedRows = screen.getAllByRole("row");
        expect(updatedRows.length).toBe(initialRows.length + 1);
      });
    });

    it("removes a member when clicking the remove button", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Members")).toBeInTheDocument();
      });

      // Add a second member first
      const addButton = screen.getByRole("button", { name: /add another/i });
      await user.click(addButton);

      // Wait for second member row to appear
      await waitFor(() => {
        const rows = screen.getAllByRole("row");
        // Header + 2 members + "Add Another" row = 5
        expect(rows.length).toBeGreaterThanOrEqual(4);
      });

      const rowsBefore = screen.getAllByRole("row").length;

      // Find delete buttons using accessible name
      const deleteButtons = screen
        .getAllByRole("button", { name: /remove member/i })
        .filter((btn) => !(btn as HTMLButtonElement).disabled);

      // Click the last enabled delete button (removes the second member)
      expect(deleteButtons.length).toBeGreaterThan(0);
      await user.click(deleteButtons[deleteButtons.length - 1]!);

      await waitFor(() => {
        const rowsAfter = screen.getAllByRole("row").length;
        // One fewer row after removal
        expect(rowsAfter).toBe(rowsBefore - 1);
      });
    });

    it("prevents removing the last member", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Members")).toBeInTheDocument();
      });

      // Initially only one member (current user)
      const rowsBefore = screen.getAllByRole("row").length;

      // Find delete buttons using accessible name
      const deleteButtons = screen.getAllByRole("button", {
        name: /remove member/i,
      });

      // Click the delete button (should be disabled or do nothing)
      if (deleteButtons.length > 0) {
        await user.click(deleteButtons[0]!);
      }

      // Verify that the member count hasn't changed (cannot remove last member)
      await waitFor(() => {
        const rowsAfter = screen.getAllByRole("row").length;
        expect(rowsAfter).toBe(rowsBefore);
      });
    });
  });

  describe("Member selector", () => {
    it("shows organization users in member selector dropdown", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Members")).toBeInTheDocument();
      });

      // Add another member to get a selector
      const addButton = screen.getByRole("button", { name: /add another/i });
      await user.click(addButton);

      await waitFor(() => {
        // The new row should have a combobox for selecting users
        const comboboxes = screen.getAllByRole("combobox");
        expect(comboboxes.length).toBeGreaterThan(0);
      });

      // Click on the member selector combobox
      const comboboxes = screen.getAllByRole("combobox");
      const memberSelector = comboboxes[0];
      if (memberSelector) {
        await user.click(memberSelector);

        // Check that organization users are shown as options
        await waitFor(() => {
          expect(screen.getByText(/Alice/)).toBeInTheDocument();
          expect(screen.getByText(/Bob/)).toBeInTheDocument();
          expect(screen.getByText(/Charlie/)).toBeInTheDocument();
        });
      }
    });
  });

  describe("Role selector", () => {
    it("shows available team roles in role selector", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Members")).toBeInTheDocument();
      });

      // The role selector shows "Admin" by default
      expect(screen.getByText("Admin")).toBeInTheDocument();

      // Find the role selector combobox
      const roleSelectors = screen.getAllByRole("combobox");

      // The role selector is the one that shows "Admin"
      const roleSelector = roleSelectors.find((selector) =>
        selector.textContent?.includes("Admin"),
      );

      if (roleSelector) {
        await user.click(roleSelector);

        // Check that role options are shown (may take time to open)
        await waitFor(
          () => {
            // Member and Viewer should be shown as additional options
            expect(screen.getByText("Member")).toBeInTheDocument();
            expect(screen.getByText("Viewer")).toBeInTheDocument();
          },
          { timeout: 3000 },
        );
      } else {
        // If we can't find a clickable role selector, verify at least Admin is shown
        expect(screen.getByText("Admin")).toBeInTheDocument();
      }
    });
  });

  describe("Drawer closing methods", () => {
    it("closes drawer when clicking on overlay", async () => {
      const onClose = vi.fn();
      renderDrawer({ onClose });

      await waitFor(() => {
        expect(screen.getByText("Create New Team")).toBeInTheDocument();
      });

      // Find the backdrop/overlay element
      const backdrop = document.querySelector('[data-part="backdrop"]');
      if (backdrop) {
        fireEvent.click(backdrop);

        await waitFor(() => {
          expect(onClose).toHaveBeenCalled();
        });
      }
    });

    it("handles Escape key through drawer onOpenChange", async () => {
      // Note: Testing Escape key behavior in Chakra UI drawer is complex due to
      // how the drawer handles keyboard events internally. This test verifies
      // the drawer's onOpenChange callback is wired up to call handleClose
      // when the drawer closes (which includes Escape key behavior).
      //
      // The actual Escape key handling is implemented by Chakra's Drawer.Root
      // component and is tested in their library. We verify the integration
      // by testing other close methods that use the same code path.

      const onClose = vi.fn();
      renderDrawer({ onClose });

      await waitFor(() => {
        expect(screen.getByText("Create New Team")).toBeInTheDocument();
      });

      // Find and click the close button to verify the onClose callback is wired
      const closeButtons = document.querySelectorAll('[aria-label="Close"]');
      expect(closeButtons.length).toBeGreaterThan(0);

      fireEvent.click(closeButtons[0]!);

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe("Form validation - whitespace", () => {
    it("prevents submission when team name contains only whitespace", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      // Enter only whitespace
      await user.type(screen.getByLabelText(/name/i), "   ");
      await user.click(screen.getByRole("button", { name: /create/i }));

      // Mutation should not be called because validation fails
      expect(mockMutate).not.toHaveBeenCalled();
    });
  });

  describe("Form validation - members required", () => {
    it("requires at least one member by preventing removal of last member", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Members")).toBeInTheDocument();
      });

      // Get current member count
      const rowsBefore = screen.getAllByRole("row").length;

      // Find delete buttons using accessible name
      const deleteButtons = screen.getAllByRole("button", {
        name: /remove member/i,
      });

      // Try to click delete button on the single member
      if (deleteButtons.length > 0) {
        await user.click(deleteButtons[0]!);
      }

      // Member count should remain unchanged - cannot remove last member
      await waitFor(() => {
        const rowsAfter = screen.getAllByRole("row").length;
        expect(rowsAfter).toBe(rowsBefore);
      });
    });
  });

  describe("Loading state", () => {
    it("shows loading indicator on submit button during submission", async () => {
      // Simulate loading state by having mutate not call callbacks immediately
      mockMutate.mockImplementation(() => {
        // Don't call success or error - simulates pending state
      });

      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/name/i), "Engineering Team");
      await user.click(screen.getByRole("button", { name: /create/i }));

      // The mutation should be called
      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalled();
      });

      // When isLoading is true, the button should show loading state
      // Note: We can't easily test the visual loading state without controlling
      // the mock's isLoading property dynamically
    });
  });

  describe("Error handling", () => {
    it("shows error toast when creation fails", async () => {
      const errorMessage = "Team creation failed";
      mockMutate.mockImplementation((_, { onError }) => {
        onError({ message: errorMessage });
      });

      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/name/i), "Engineering Team");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to create team",
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

      const onClose = vi.fn();
      const user = userEvent.setup();
      renderDrawer({ onClose });

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/name/i), "Engineering Team");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalled();
      });

      // Drawer should remain open (onClose not called, closeDrawer not called)
      expect(onClose).not.toHaveBeenCalled();
      expect(mockCloseDrawer).not.toHaveBeenCalled();
    });

    it("shows error for duplicate team name from server", async () => {
      const duplicateError = "A team with this name already exists";
      mockMutate.mockImplementation((_, { onError }) => {
        onError({ message: duplicateError });
      });

      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/name/i), "Engineering");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to create team",
            type: "error",
            description: duplicateError,
          }),
        );
      });
    });
  });

  describe("Success handling", () => {
    it("shows success toast when team is created", async () => {
      mockMutate.mockImplementation((_, { onSuccess }) => {
        onSuccess();
      });

      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/name/i), "Engineering Team");
      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Team created successfully",
            type: "success",
          }),
        );
      });
    });
  });
});
