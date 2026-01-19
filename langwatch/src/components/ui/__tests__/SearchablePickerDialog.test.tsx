/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileText } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchablePickerDialog } from "../searchable-picker-dialog";

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("SearchablePickerDialog", () => {
  const mockOnClose = vi.fn();
  const mockOnSelect = vi.fn();
  const mockOnCreate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // Helper to render a basic picker dialog
  const renderDialog = (props: { open?: boolean; items?: string[] } = {}) => {
    const { open = true, items = ["Item 1", "Item 2", "Item 3"] } = props;

    return render(
      <SearchablePickerDialog.Root
        open={open}
        onClose={mockOnClose}
        title="Select Item"
      >
        <SearchablePickerDialog.Body>
          <SearchablePickerDialog.SearchInput placeholder="Search items..." />
          <SearchablePickerDialog.ScrollableContent>
            <SearchablePickerDialog.Section title="All Items">
              {items.map((item) => (
                <SearchablePickerDialog.ItemRow
                  key={item}
                  icon={<FileText size={16} />}
                  name={item}
                  secondaryText="Type"
                  onClick={() => mockOnSelect(item)}
                  testId={`item-row-${item.replace(/\s/g, "-")}`}
                />
              ))}
            </SearchablePickerDialog.Section>
          </SearchablePickerDialog.ScrollableContent>
          <SearchablePickerDialog.CreateButton
            label="Create new item"
            onClick={mockOnCreate}
          />
        </SearchablePickerDialog.Body>
        <SearchablePickerDialog.Footer />
      </SearchablePickerDialog.Root>,
      { wrapper: Wrapper },
    );
  };

  describe("Root component", () => {
    it("renders dialog with title", async () => {
      renderDialog();
      await waitFor(() => {
        expect(screen.getByText("Select Item")).toBeInTheDocument();
      });
    });

    it("does not render when closed", () => {
      renderDialog({ open: false });
      expect(screen.queryByText("Select Item")).not.toBeInTheDocument();
    });
  });

  describe("SearchInput component", () => {
    it("renders search input with placeholder", async () => {
      renderDialog();
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Search items..."),
        ).toBeInTheDocument();
      });
    });

    it("auto-focuses search input on open", async () => {
      renderDialog();
      await waitFor(() => {
        const input = screen.getByPlaceholderText("Search items...");
        expect(document.activeElement).toBe(input);
      });
    });

    it("allows typing in search input", async () => {
      const user = userEvent.setup();
      renderDialog();

      const input = screen.getByPlaceholderText("Search items...");
      await user.type(input, "test");

      expect(input).toHaveValue("test");
    });
  });

  describe("Section component", () => {
    it("renders section with title", async () => {
      renderDialog();
      await waitFor(() => {
        expect(screen.getByText("All Items")).toBeInTheDocument();
      });
    });
  });

  describe("ItemRow component", () => {
    it("renders item rows with name and secondary text", async () => {
      renderDialog();
      await waitFor(() => {
        expect(screen.getByText("Item 1")).toBeInTheDocument();
        expect(screen.getByText("Item 2")).toBeInTheDocument();
        expect(screen.getByText("Item 3")).toBeInTheDocument();
      });
    });

    it("calls onSelect and closes when clicking an item", async () => {
      const user = userEvent.setup();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Item 1")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("item-row-Item-1"));

      expect(mockOnSelect).toHaveBeenCalledWith("Item 1");
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("CreateButton component", () => {
    it("renders create button", async () => {
      renderDialog();
      await waitFor(() => {
        expect(screen.getByText("Create new item")).toBeInTheDocument();
      });
    });

    it("calls onCreate and closes when clicking create button", async () => {
      const user = userEvent.setup();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByTestId("picker-create-button")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("picker-create-button"));

      expect(mockOnCreate).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Footer component", () => {
    it("renders cancel button", async () => {
      renderDialog();
      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });
    });

    it("closes dialog when clicking cancel", async () => {
      const user = userEvent.setup();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Cancel"));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("EmptyState component", () => {
    it("renders empty state when isEmpty is true", async () => {
      render(
        <SearchablePickerDialog.Root
          open={true}
          onClose={mockOnClose}
          title="Select Item"
        >
          <SearchablePickerDialog.Body
            isEmpty={true}
            emptyState={
              <SearchablePickerDialog.EmptyState
                icon={<FileText size={32} />}
                title="No items yet"
                description="Create your first item to get started."
                actionLabel="Create item"
                onAction={mockOnCreate}
              />
            }
          >
            <div>Should not render</div>
          </SearchablePickerDialog.Body>
          <SearchablePickerDialog.Footer />
        </SearchablePickerDialog.Root>,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("No items yet")).toBeInTheDocument();
        expect(
          screen.getByText("Create your first item to get started."),
        ).toBeInTheDocument();
      });

      expect(screen.queryByText("Should not render")).not.toBeInTheDocument();
    });

    it("calls onAction when clicking empty state button", async () => {
      const user = userEvent.setup();
      render(
        <SearchablePickerDialog.Root
          open={true}
          onClose={mockOnClose}
          title="Select Item"
        >
          <SearchablePickerDialog.Body
            isEmpty={true}
            emptyState={
              <SearchablePickerDialog.EmptyState
                icon={<FileText size={32} />}
                title="No items yet"
                description="Create your first item."
                actionLabel="Create item"
                onAction={mockOnCreate}
              />
            }
          >
            <div>Content</div>
          </SearchablePickerDialog.Body>
          <SearchablePickerDialog.Footer />
        </SearchablePickerDialog.Root>,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("picker-empty-state-action"),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("picker-empty-state-action"));

      expect(mockOnCreate).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Loading state", () => {
    it("shows spinner when loading", async () => {
      render(
        <SearchablePickerDialog.Root
          open={true}
          onClose={mockOnClose}
          title="Select Item"
        >
          <SearchablePickerDialog.Body isLoading={true}>
            <div>Should not render</div>
          </SearchablePickerDialog.Body>
          <SearchablePickerDialog.Footer />
        </SearchablePickerDialog.Root>,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        const spinner = document.querySelector(".chakra-spinner");
        expect(spinner).toBeInTheDocument();
      });

      expect(screen.queryByText("Should not render")).not.toBeInTheDocument();
    });
  });

  describe("NoResults component", () => {
    it("renders no results message", async () => {
      render(
        <SearchablePickerDialog.Root
          open={true}
          onClose={mockOnClose}
          title="Select Item"
        >
          <SearchablePickerDialog.Body>
            <SearchablePickerDialog.Section title="Results">
              <SearchablePickerDialog.NoResults message="No items found" />
            </SearchablePickerDialog.Section>
          </SearchablePickerDialog.Body>
          <SearchablePickerDialog.Footer />
        </SearchablePickerDialog.Root>,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("No items found")).toBeInTheDocument();
      });
    });
  });
});
