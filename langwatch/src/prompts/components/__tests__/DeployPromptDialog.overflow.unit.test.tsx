/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeployPromptDialog } from "../DeployPromptDialog";

// Mock tRPC api
const mockUseQuery = vi.fn();
const mockMutateAsync = vi.fn().mockResolvedValue({});
const mockInvalidate = vi.fn().mockResolvedValue(undefined);
const mockPromptTagsQuery = vi.fn();
const mockCreateTagMutateAsync = vi.fn().mockResolvedValue({});
const mockDeleteTagMutateAsync = vi.fn().mockResolvedValue({});

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
    promptTags: {
      getAll: {
        useQuery: (...args: unknown[]) => mockPromptTagsQuery(...args),
      },
      create: {
        useMutation: () => ({
          mutateAsync: mockCreateTagMutateAsync,
        }),
      },
      delete: {
        useMutation: () => ({
          mutateAsync: mockDeleteTagMutateAsync,
        }),
      },
    },
    useContext: () => ({
      prompts: {
        getTagsForConfig: {
          invalidate: mockInvalidate,
        },
      },
      promptTags: {
        getAll: {
          invalidate: vi.fn().mockResolvedValue(undefined),
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

// Mock the custom Select to render a native <select> for testability.
// SelectRoot forwards flex and maxWidth as data attributes so tests can
// assert the anti-overflow layout props without relying on JSDOM style computation.
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
    <div
      data-testid="select-root"
      data-flex={rest["flex"] as string | undefined}
      data-max-width={rest["maxWidth"] as string | undefined}
    >
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

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  configId: "config-123",
  handle: "pizza-prompt",
  projectId: "project-1",
};

function setupPromptTags(extraTags: Array<{ name: string; id?: string }> = []) {
  const defaultTags = [
    { name: "production", id: "production-id" },
    { name: "staging", id: "staging-id" },
  ];
  const allTags = [...defaultTags, ...extraTags];
  mockPromptTagsQuery.mockReturnValue({
    data: allTags,
    isLoading: false,
    refetch: vi.fn().mockResolvedValue({ data: allTags }),
  });
}

function setupQueries({
  versions = [] as Array<{ version: number; versionId: string; commitMessage: string }>,
  tags = [] as Array<{ tagId: string; promptTag: { name: string }; versionId: string }>,
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

function renderDialog(props = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DeployPromptDialog {...defaultProps} {...props} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  setupPromptTags();
});

afterEach(() => {
  cleanup();
});

describe("Scenario: Version Select inputs stay within the modal width", () => {
  /** @scenario Version Select inputs stay within the modal width */
  it("renders version Select with flex layout props that prevent modal overflow", async () => {
    const longCommitMessage = "a".repeat(220);
    setupQueries({
      versions: [
        { version: 1, versionId: "v1-id", commitMessage: "Short message" },
        {
          version: 2,
          versionId: "v2-id",
          commitMessage: longCommitMessage,
        },
      ],
    });

    const { container } = renderDialog();

    await waitFor(() => {
      expect(screen.getByLabelText("Production version")).toBeInTheDocument();
    });

    // Each Select.Root rendered for a tag row must carry the anti-overflow
    // flex props that clamp the trigger to the row width.
    const selectRoots = container.querySelectorAll(
      '[data-testid="select-root"]',
    );
    expect(selectRoots.length).toBeGreaterThan(0);
    selectRoots.forEach((root) => {
      expect(root).toHaveAttribute("data-flex", "1");
      expect(root).toHaveAttribute("data-max-width", "280px");
    });
  });
});
