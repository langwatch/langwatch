/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      getTagsForConfig: {
        useQuery: (...args: unknown[]) => mockUseQuery("getTagsForConfig", ...args),
      },
      assignTag: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
          isLoading: false,
        }),
      },
    },
    useContext: () => ({
      prompts: {
        getTagsForConfig: {
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

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", apiKey: "test-api-key" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("~/prompts/components/GeneratePromptApiSnippetDialog", () => {
  const Dialog = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="snippet-dialog">{children}</div>
  );
  Dialog.Trigger = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="snippet-trigger">{children}</div>
  );
  return { GeneratePromptApiSnippetDialog: Dialog };
});

// Mock the custom Select to render a native <select> for testability
vi.mock("~/components/ui/select", () => {
  const SelectRoot = ({
    children,
    collection,
    value,
    onValueChange,
    ...rest
  }: {
    children: React.ReactNode;
    collection: { items: Array<{ label: string; value: string; version: number; commitMessage: string }> };
    value: string[];
    onValueChange: (details: { value: string[] }) => void;
    "aria-label"?: string;
    [key: string]: unknown;
  }) => (
    <div data-testid="select-root">
      <select
        aria-label={rest["aria-label"] as string}
        value={value[0] ?? ""}
        onChange={(e) => onValueChange({ value: [e.target.value] })}
      >
        <option value="">Select version</option>
        {collection.items.map(
          (item: { label: string; value: string; version: number; commitMessage: string }) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ),
        )}
      </select>
      {children}
    </div>
  );

  return {
    Select: {
      Root: SelectRoot,
      Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      Content: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      Item: () => null,
      ValueText: ({ placeholder }: { placeholder?: string }) => (
        <span>{placeholder}</span>
      ),
    },
  };
});

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
  tags = [] as Array<{ tag: string; versionId: string }>,
} = {}) {
  mockUseQuery.mockImplementation((queryName: string) => {
    if (queryName === "getAllVersionsForPrompt") {
      return { data: versions };
    }
    if (queryName === "getTagsForConfig") {
      return { data: tags };
    }
    return { data: undefined };
  });
}

function setupFetch(
  extraTags: Array<{ name: string; id?: string }> = [],
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const method = options?.method ?? "GET";

      if (method === "GET" && String(url).includes("/prompt-tags")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve([
              { name: "production", id: "production-id" },
              { name: "staging", id: "staging-id" },
              ...extraTags,
            ]),
        });
      }

      if (method === "POST" && String(url).includes("/prompt-tags")) {
        const body = JSON.parse((options?.body as string) ?? "{}") as { name?: string };
        const name = body.name ?? "";

        // Simulate duplicate check
        if (extraTags.some((l) => l.name === name)) {
          return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({}) });
        }

        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ name, id: `id-${name}` }) });
      }

      if (method === "DELETE" && String(url).includes("/prompt-tags/")) {
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
      }

      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    }),
  );
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
  setupFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

      it("displays the description about assigning versions to tags", () => {
        renderDialog();

        expect(
          screen.getByText(
            "Use tags to get specific prompt versions via the SDK and API. Prompt versions with the production tag are returned by default.",
          ),
        ).toBeInTheDocument();
      });

      it("displays the prompt slug with a copy button", () => {
        renderDialog();

        expect(screen.getByText("Slug:")).toBeInTheDocument();
        expect(screen.getByText("pizza-prompt")).toBeInTheDocument();
        expect(screen.getByTestId("copy-button")).toBeInTheDocument();
      });
    });

    describe("when showing tag rows", () => {
      beforeEach(() => {
        setupQueries();
      });

      it("displays the latest row with current version number", () => {
        renderDialog();

        expect(screen.getByText("latest")).toBeInTheDocument();
        expect(screen.getByTestId("latest-version")).toHaveTextContent("v4");
      });

      it("displays the production row with a dropdown", async () => {
        renderDialog();

        await waitFor(() => {
          expect(screen.getByText("production")).toBeInTheDocument();
          expect(
            screen.getByLabelText("Production version"),
          ).toBeInTheDocument();
        });
      });

      it("displays the staging row with a dropdown", async () => {
        renderDialog();

        await waitFor(() => {
          expect(screen.getByText("staging")).toBeInTheDocument();
          expect(screen.getByLabelText("Staging version")).toBeInTheDocument();
        });
      });

      it("does not render an editable control for the latest row", () => {
        renderDialog();

        const latestVersion = screen.getByTestId("latest-version");
        expect(latestVersion.closest("[data-testid='select-root']")).toBeNull();
      });
    });

    describe("when version dropdown shows options", () => {
      beforeEach(() => {
        setupQueries();
      });

      it("lists versions newest first with commit messages", async () => {
        renderDialog();

        await waitFor(() => {
          expect(screen.getByLabelText("Production version")).toBeInTheDocument();
        });

        const prodSelect = screen.getByLabelText("Production version");
        const options = prodSelect.querySelectorAll("option");

        // First option is the placeholder
        expect(options[0]).toHaveTextContent("Select version");
        // Versions should be newest first
        expect(options[1]).toHaveTextContent("v4");
        expect(options[1]).toHaveTextContent("Update model");
        expect(options[2]).toHaveTextContent("v3");
        expect(options[3]).toHaveTextContent("v2");
        expect(options[4]).toHaveTextContent("v1");
      });
    });

    describe("when tags are already assigned", () => {
      it("initializes dropdowns from current tag assignments", async () => {
        setupQueries({
          tags: [
            { tag:"production", versionId: "v2-id" },
            { tag:"staging", versionId: "v3-id" },
          ],
        });

        renderDialog();

        await waitFor(() => {
          const prodSelect = screen.getByLabelText("Production version") as HTMLSelectElement;
          expect(prodSelect.value).toBe("v2-id");
        });

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

    describe("when showing dialog controls", () => {
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

      it("calls assignTag with the selected production version", async () => {
        setupQueries();
        renderDialog();

        await waitFor(() => {
          expect(screen.getByLabelText("Production version")).toBeInTheDocument();
        });

        const prodSelect = screen.getByLabelText("Production version");
        fireEvent.change(prodSelect, { target: { value: "v3-id" } });

        const saveButton = screen.getByRole("button", { name: /save changes/i });
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledWith({
            projectId: "project-1",
            configId: "config-123",
            versionId: "v3-id",
            tag: "production",
          });
        });
      });
    });

    describe("when user selects a staging version and saves", () => {
      beforeEach(() => {
        mockMutateAsync.mockClear();
        mockInvalidate.mockClear();
      });

      it("calls assignTag with the selected staging version", async () => {
        setupQueries();
        renderDialog();

        await waitFor(() => {
          expect(screen.getByLabelText("Staging version")).toBeInTheDocument();
        });

        const stagSelect = screen.getByLabelText("Staging version");
        fireEvent.change(stagSelect, { target: { value: "v2-id" } });

        const saveButton = screen.getByRole("button", { name: /save changes/i });
        fireEvent.click(saveButton);

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledWith({
            projectId: "project-1",
            configId: "config-123",
            versionId: "v2-id",
            tag: "staging",
          });
        });
      });
    });

    describe("when user changes both tags and saves", () => {
      beforeEach(() => {
        mockMutateAsync.mockClear();
        mockInvalidate.mockClear();
      });

      it("calls assignTag for both production and staging", async () => {
        setupQueries();
        renderDialog();

        await waitFor(() => {
          expect(screen.getByLabelText("Production version")).toBeInTheDocument();
        });

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
            expect.objectContaining({ tag:"production", versionId: "v4-id" }),
          );
          expect(mockMutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({ tag:"staging", versionId: "v1-id" }),
          );
        });
      });
    });

    describe("when no changes are made and save is clicked", () => {
      it("closes the dialog without calling assignTag", async () => {
        const onClose = vi.fn();
        mockMutateAsync.mockClear();
        setupQueries({
          tags: [{ tag:"production", versionId: "v2-id" }],
        });
        renderDialog({ onClose });

        fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

        await waitFor(() => {
          expect(onClose).toHaveBeenCalled();
        });
        expect(mockMutateAsync).not.toHaveBeenCalled();
      });
    });

    describe("Scenario: Deploy dialog renders built-in and custom tag rows", () => {
      it("renders rows for latest, production, staging, and the custom tag", async () => {
        setupFetch([{ name: "canary", id: "canary-id" }]);
        setupQueries({
          tags: [
            { tag:"production", versionId: "v1-id" },
            { tag:"canary", versionId: "v2-id" },
          ],
        });

        renderDialog();

        await waitFor(() => {
          expect(screen.getByText("latest")).toBeInTheDocument();
          expect(screen.getByText("production")).toBeInTheDocument();
          expect(screen.getByText("staging")).toBeInTheDocument();
          expect(screen.getByText("canary")).toBeInTheDocument();
        });
      });

      it("renders a version selector for each non-latest tag row", async () => {
        setupFetch([{ name: "canary", id: "canary-id" }]);
        setupQueries();

        renderDialog();

        await waitFor(() => {
          expect(screen.getByLabelText("Production version")).toBeInTheDocument();
          expect(screen.getByLabelText("Staging version")).toBeInTheDocument();
          expect(screen.getByLabelText("Canary version")).toBeInTheDocument();
        });
      });
    });

    describe("Scenario: Built-in tags have no delete button", () => {
      it("does not render a delete button for the latest row", async () => {
        setupFetch();
        setupQueries();

        renderDialog();

        await waitFor(() => {
          expect(screen.getByText("latest")).toBeInTheDocument();
        });

        expect(
          screen.queryByRole("button", { name: /delete tag latest/i }),
        ).not.toBeInTheDocument();
      });

      it("renders a delete button for the production row", async () => {
        setupFetch();
        setupQueries();

        renderDialog();

        await waitFor(() => {
          expect(screen.getByText("production")).toBeInTheDocument();
        });

        expect(
          screen.getByRole("button", { name: /delete tag production/i }),
        ).toBeInTheDocument();
      });

      it("renders a delete button for the staging row", async () => {
        setupFetch();
        setupQueries();

        renderDialog();

        await waitFor(() => {
          expect(screen.getByText("staging")).toBeInTheDocument();
        });

        expect(
          screen.getByRole("button", { name: /delete tag staging/i }),
        ).toBeInTheDocument();
      });
    });

    describe("Scenario: Deploy dialog shows empty state when no custom tags exist", () => {
      it("shows only built-in rows and the '+ Add tag' button", async () => {
        setupFetch();
        setupQueries();

        renderDialog();

        await waitFor(() => {
          expect(screen.getByText("latest")).toBeInTheDocument();
          expect(screen.getByText("production")).toBeInTheDocument();
          expect(screen.getByText("staging")).toBeInTheDocument();
          expect(screen.getByRole("button", { name: /\+ add tag/i })).toBeInTheDocument();
        });
      });
    });

    describe("Scenario: Deploy dialog adds a custom tag row when user confirms input", () => {
      it("adds a new custom tag row when user types and confirms", async () => {
        // First fetch returns no custom tags; after POST+refetch, returns canary
        let fetchCallCount = 0;
        vi.stubGlobal(
          "fetch",
          vi.fn().mockImplementation((url: string, options?: RequestInit) => {
            const method = options?.method ?? "GET";

            if (method === "GET" && String(url).includes("/prompt-tags")) {
              fetchCallCount++;
              if (fetchCallCount === 1) {
                return Promise.resolve({
                  ok: true,
                  status: 200,
                  json: () => Promise.resolve([
                    { name: "production", id: "production-id" },
                    { name: "staging", id: "staging-id" },
                  ]),
                });
              }
              // After POST, return with canary
              return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve([
                  { name: "production", id: "production-id" },
                  { name: "staging", id: "staging-id" },
                  { name: "canary", id: "canary-id" },
                ]),
              });
            }

            if (method === "POST" && String(url).includes("/prompt-tags")) {
              return Promise.resolve({
                ok: true,
                status: 201,
                json: () => Promise.resolve({ name: "canary", id: "canary-id" }),
              });
            }

            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
          }),
        );

        setupQueries();
        renderDialog();

        // Wait for initial render
        await waitFor(() => {
          expect(screen.getByRole("button", { name: /\+ add tag/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: /\+ add tag/i }));

        const input = screen.getByPlaceholderText(/tag name/i);
        fireEvent.change(input, { target: { value: "canary" } });
        fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

        await waitFor(() => {
          expect(screen.getByText("canary")).toBeInTheDocument();
        });
      });
    });

    describe("Scenario: Deploy dialog rejects duplicate custom tag name", () => {
      it("shows an error when trying to add an existing tag name", async () => {
        setupFetch([{ name: "canary", id: "canary-id" }]);
        setupQueries();

        renderDialog();

        await waitFor(() => {
          expect(screen.getByRole("button", { name: /\+ add tag/i })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: /\+ add tag/i }));

        const input = screen.getByPlaceholderText(/tag name/i);
        fireEvent.change(input, { target: { value: "canary" } });
        fireEvent.click(screen.getByRole("button", { name: /^add$/i }));

        await waitFor(() => {
          expect(screen.getByText("canary already exists")).toBeInTheDocument();
        });
      });
    });

    describe("Scenario: Deploy dialog removes custom tag row after delete confirmation", () => {
      it("removes the custom tag row when user confirms deletion", async () => {
        let fetchCallCount = 0;
        vi.stubGlobal(
          "fetch",
          vi.fn().mockImplementation((url: string, options?: RequestInit) => {
            const method = options?.method ?? "GET";

            if (method === "GET" && String(url).includes("/prompt-tags")) {
              fetchCallCount++;
              if (fetchCallCount === 1) {
                return Promise.resolve({
                  ok: true,
                  status: 200,
                  json: () => Promise.resolve([
                    { name: "production", id: "production-id" },
                    { name: "staging", id: "staging-id" },
                    { name: "canary", id: "canary-id" },
                  ]),
                });
              }
              // After DELETE, return without canary
              return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve([
                  { name: "production", id: "production-id" },
                  { name: "staging", id: "staging-id" },
                ]),
              });
            }

            if (method === "DELETE" && String(url).includes("/prompt-tags/")) {
              return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
            }

            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
          }),
        );

        setupQueries();
        renderDialog();

        await waitFor(() => {
          expect(screen.getByText("canary")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: /delete tag canary/i }));

        // Type "delete" in the confirmation input and confirm
        await waitFor(() => {
          expect(screen.getByPlaceholderText(/type 'delete' to confirm/i)).toBeInTheDocument();
        });
        fireEvent.change(screen.getByPlaceholderText(/type 'delete' to confirm/i), {
          target: { value: "delete" },
        });
        fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

        await waitFor(() => {
          expect(screen.queryByText("canary")).not.toBeInTheDocument();
        });
      });

      it("shows a confirmation dialog warning that SDK callers may be affected", async () => {
        setupFetch([{ name: "canary", id: "canary-id" }]);
        setupQueries();

        renderDialog();

        await waitFor(() => {
          expect(screen.getByText("canary")).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: /delete tag canary/i }));

        await waitFor(() => {
          expect(
            screen.getByText(/SDK and API callers using this tag will no longer be able to resolve it/i),
          ).toBeInTheDocument();
        });
      });
    });

    describe("Scenario: Custom tag delete button is visible only for custom tags", () => {
      it("renders a delete button for the custom tag row", async () => {
        setupFetch([{ name: "canary", id: "canary-id" }]);
        setupQueries();

        renderDialog();

        await waitFor(() => {
          expect(
            screen.getByRole("button", { name: /delete tag canary/i }),
          ).toBeInTheDocument();
        });
      });

      it("renders a delete button for the production row", async () => {
        setupFetch([{ name: "canary", id: "canary-id" }]);
        setupQueries();

        renderDialog();

        await waitFor(() => {
          expect(screen.getByText("production")).toBeInTheDocument();
        });

        expect(
          screen.getByRole("button", { name: /delete tag production/i }),
        ).toBeInTheDocument();
      });
    });
  });
});
