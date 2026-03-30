/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeployPromptDialog } from "../DeployPromptDialog";

// Mock tRPC api
const mockUseQuery = vi.fn();
const mockMutateAsync = vi.fn().mockResolvedValue({});
const mockInvalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("~/utils/api", () => ({
  api: {
    prompts: {
      getAllVersionsForPrompt: {
        useQuery: (...args: unknown[]) => mockUseQuery("getAllVersionsForPrompt", ...args),
      },
      getLabelsForConfig: {
        useQuery: (...args: unknown[]) => mockUseQuery("getLabelsForConfig", ...args),
      },
      assignLabel: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
          isLoading: false,
        }),
      },
    },
    useContext: () => ({
      prompts: {
        getLabelsForConfig: {
          invalidate: mockInvalidate,
        },
      },
    }),
  },
}));

vi.mock("~/components/CopyButton", () => ({
  CopyButton: ({ value, label }: { value: string; label: string }) => (
    <button data-testid="copy-button" aria-label={label}>
      Copy {value}
    </button>
  ),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const mockVersions = [
  { version: 1, versionId: "v1-id", commitMessage: "Initial version" },
  { version: 2, versionId: "v2-id", commitMessage: "Fix typo" },
  { version: 3, versionId: "v3-id", commitMessage: "Add examples" },
  { version: 4, versionId: "v4-id", commitMessage: "Update model" },
];

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  configId: "config-123",
  handle: "pizza-prompt",
  projectId: "project-1",
};

function setupQueries({
  versions = mockVersions,
  labels = [] as Array<{ label: string; versionId: string }>,
} = {}) {
  mockUseQuery.mockImplementation((queryName: string) => {
    if (queryName === "getAllVersionsForPrompt") {
      return { data: versions };
    }
    if (queryName === "getLabelsForConfig") {
      return { data: labels };
    }
    return { data: undefined };
  });
}

function renderDialog(props = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DeployPromptDialog {...defaultProps} {...props} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Feature: Deploy Prompt Dialog", () => {
  describe("<DeployPromptDialog/>", () => {
    describe("when the dialog is open", () => {
      beforeEach(() => {
        setupQueries();
      });

      it("displays the dialog title 'Deploy prompt'", () => {
        renderDialog();

        expect(screen.getByText("Deploy prompt")).toBeInTheDocument();
      });

      it("displays the description about assigning versions to labels", () => {
        renderDialog();

        expect(
          screen.getByText(
            "Assign prompt versions to environment labels. Default (no label) returns the latest version.",
          ),
        ).toBeInTheDocument();
      });

      it("displays the prompt slug with a copy button", () => {
        renderDialog();

        expect(screen.getByText("pizza-prompt")).toBeInTheDocument();
        expect(screen.getByTestId("copy-button")).toBeInTheDocument();
      });
    });

    describe("when showing label rows", () => {
      beforeEach(() => {
        setupQueries();
      });

      it("displays the latest row with current version number", () => {
        renderDialog();

        expect(screen.getByText("latest")).toBeInTheDocument();
        expect(screen.getByTestId("latest-version")).toHaveTextContent("v4");
      });

      it("displays the production row with a dropdown", () => {
        renderDialog();

        expect(screen.getByText("production")).toBeInTheDocument();
        expect(
          screen.getByLabelText("Production version"),
        ).toBeInTheDocument();
      });

      it("displays the staging row with a dropdown", () => {
        renderDialog();

        expect(screen.getByText("staging")).toBeInTheDocument();
        expect(screen.getByLabelText("Staging version")).toBeInTheDocument();
      });

      it("does not render an editable control for the latest row", () => {
        renderDialog();

        // The latest row should not have a select/dropdown
        const latestVersion = screen.getByTestId("latest-version");
        const latestRow = latestVersion.closest("[class]");
        expect(latestRow).toBeTruthy();
        // Verify no select inside the latest row area
        expect(
          within(latestVersion).queryByRole("combobox"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when version dropdown shows options", () => {
      beforeEach(() => {
        setupQueries();
      });

      it("lists versions newest first with commit messages", () => {
        renderDialog();

        const prodSelect = screen.getByLabelText("Production version");
        const options = within(prodSelect).getAllByRole("option");

        // First option is the placeholder
        expect(options[0]).toHaveTextContent("-- Select version --");
        // Versions should be newest first
        expect(options[1]).toHaveTextContent("v4");
        expect(options[1]).toHaveTextContent("Update model");
        expect(options[2]).toHaveTextContent("v3");
        expect(options[3]).toHaveTextContent("v2");
        expect(options[4]).toHaveTextContent("v1");
      });
    });

    describe("when labels are already assigned", () => {
      it("initializes dropdowns from current label assignments", () => {
        setupQueries({
          labels: [
            { label: "production", versionId: "v2-id" },
            { label: "staging", versionId: "v3-id" },
          ],
        });

        renderDialog();

        const prodSelect = screen.getByLabelText(
          "Production version",
        ) as HTMLSelectElement;
        const stagSelect = screen.getByLabelText(
          "Staging version",
        ) as HTMLSelectElement;

        expect(prodSelect.value).toBe("v2-id");
        expect(stagSelect.value).toBe("v3-id");
      });
    });

    describe("when dialog is closed", () => {
      it("does not render content", () => {
        setupQueries();
        renderDialog({ isOpen: false });

        expect(screen.queryByText("Deploy prompt")).not.toBeInTheDocument();
      });
    });

    describe("when save button is clicked", () => {
      it("displays the Save changes button", () => {
        setupQueries();
        renderDialog();

        expect(
          screen.getByRole("button", { name: /save changes/i }),
        ).toBeInTheDocument();
      });
    });

    describe("when user selects a production version and saves", () => {
      beforeEach(() => {
        mockMutateAsync.mockClear();
        mockInvalidate.mockClear();
      });

      it("calls assignLabel with the selected production version", async () => {
        setupQueries();
        renderDialog();

        const prodSelect = screen.getByLabelText("Production version");
        fireEvent.change(prodSelect, { target: { value: "v3-id" } });

        const saveButton = screen.getByRole("button", { name: /save changes/i });
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledWith({
            projectId: "project-1",
            configId: "config-123",
            versionId: "v3-id",
            label: "production",
          });
        });
      });
    });

    describe("when user selects a staging version and saves", () => {
      beforeEach(() => {
        mockMutateAsync.mockClear();
        mockInvalidate.mockClear();
      });

      it("calls assignLabel with the selected staging version", async () => {
        setupQueries();
        renderDialog();

        const stagSelect = screen.getByLabelText("Staging version");
        fireEvent.change(stagSelect, { target: { value: "v2-id" } });

        const saveButton = screen.getByRole("button", { name: /save changes/i });
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledWith({
            projectId: "project-1",
            configId: "config-123",
            versionId: "v2-id",
            label: "staging",
          });
        });
      });
    });

    describe("when user changes both labels and saves", () => {
      beforeEach(() => {
        mockMutateAsync.mockClear();
        mockInvalidate.mockClear();
      });

      it("calls assignLabel for both production and staging", async () => {
        setupQueries();
        renderDialog();

        fireEvent.change(screen.getByLabelText("Production version"), {
          target: { value: "v4-id" },
        });
        fireEvent.change(screen.getByLabelText("Staging version"), {
          target: { value: "v1-id" },
        });

        fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledTimes(2);
          expect(mockMutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({ label: "production", versionId: "v4-id" }),
          );
          expect(mockMutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({ label: "staging", versionId: "v1-id" }),
          );
        });
      });
    });

    describe("when no changes are made and save is clicked", () => {
      it("closes the dialog without calling assignLabel", async () => {
        const onClose = vi.fn();
        mockMutateAsync.mockClear();
        setupQueries({
          labels: [{ label: "production", versionId: "v2-id" }],
        });
        renderDialog({ onClose });

        fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

        await waitFor(() => {
          expect(onClose).toHaveBeenCalled();
        });
        expect(mockMutateAsync).not.toHaveBeenCalled();
      });
    });
  });
});
