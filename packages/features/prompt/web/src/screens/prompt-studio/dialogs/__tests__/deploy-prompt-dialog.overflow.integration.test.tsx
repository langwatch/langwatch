/**
 * @vitest-environment jsdom
 * @see specs/prompts/deploy-prompt-dialog.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockHost = { succeeded: vi.fn(), failed: vi.fn() };
vi.mock("../../../../model/prompt-host", () => ({
  usePromptHost: () => mockHost,
}));

vi.mock("../../../../behavior/use-prompt-project", () => ({
  usePromptProject: () => ({ project: { id: "project-1", apiKey: "test-api-key" } }),
}));

const mockCreateTagMutateAsync = vi.fn().mockResolvedValue({});
const mockDeleteTagMutateAsync = vi.fn().mockResolvedValue({});
// A stable reference: the dialog's own effect depends on this array, and a
// fresh literal on every render would re-fire that effect forever.
const STABLE_TAGS = [
  { name: "production", id: "production-id" },
  { name: "staging", id: "staging-id" },
];
const mockRefetchTags = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../../behavior/use-prompt-tags", () => ({
  usePromptTags: () => ({
    data: STABLE_TAGS,
    refetch: mockRefetchTags,
    createTag: mockCreateTagMutateAsync,
    deleteTag: mockDeleteTagMutateAsync,
  }),
}));

const mockVersionsQuery = vi.fn();
const mockTagsQuery = vi.fn();
const mockMutateAsync = vi.fn().mockResolvedValue({});
const mockInvalidate = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../../behavior/prompt-api", () => ({
  promptApi: {
    prompts: {
      getAllVersionsForPrompt: { useQuery: () => mockVersionsQuery() },
      getTagsForConfig: { useQuery: () => mockTagsQuery() },
      assignTag: { useMutation: () => ({ mutateAsync: mockMutateAsync, isLoading: false }) },
    },
    promptTags: {
      create: { useMutation: () => ({ mutateAsync: mockCreateTagMutateAsync }) },
      delete: { useMutation: () => ({ mutateAsync: mockDeleteTagMutateAsync }) },
    },
    useUtils: () => ({
      prompts: { getTagsForConfig: { invalidate: mockInvalidate } },
      promptTags: { getAll: { invalidate: vi.fn().mockResolvedValue(undefined) } },
    }),
  },
}));

vi.mock("../generate-prompt-api-snippet-dialog", () => {
  const Dialog = ({ children }: { children: ReactNode }) => (
    <div data-testid="snippet-dialog">{children}</div>
  );
  Dialog.Trigger = ({ children }: { children: ReactNode }) => (
    <div data-testid="snippet-trigger">{children}</div>
  );
  return { GeneratePromptApiSnippetDialog: Dialog };
});

vi.mock("../../../../ui/blocks/delete-confirmation-dialog", () => ({
  DeleteConfirmationDialog: () => null,
}));

// The custom Select renders a native <select> for testability, and forwards
// `flex` / `maxWidth` as data attributes so the test can assert the
// anti-overflow layout props without relying on JSDOM style computation.
vi.mock("@langwatch/design-system/select", () => {
  const SelectRoot = ({
    children,
    collection,
    value,
    onValueChange,
    ...rest
  }: {
    children: ReactNode;
    collection: { items: Array<{ label: string; value: string }> };
    value: string[];
    onValueChange: (details: { value: string[] }) => void;
    "aria-label"?: string;
    [key: string]: unknown;
  }) => (
    <div
      data-testid="select-root"
      data-flex={rest.flex as string | undefined}
      data-max-width={rest.maxWidth as string | undefined}
    >
      <select
        aria-label={rest["aria-label"] as string}
        value={value[0] ?? ""}
        onChange={(e) => onValueChange({ value: [e.target.value] })}
      >
        <option value="">Select version</option>
        {collection.items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {children}
    </div>
  );

  return {
    Select: {
      Root: SelectRoot,
      Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
      Content: ({ children }: { children: ReactNode }) => <>{children}</>,
      Item: () => null,
      ValueText: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    },
  };
});

import { DeployPromptDialog } from "../deploy-prompt-dialog";

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  configId: "config-123",
  handle: "pizza-prompt",
  projectId: "project-1",
};

function renderDialog(props = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DeployPromptDialog {...defaultProps} {...props} />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTagsQuery.mockReturnValue({ data: [] });
});

afterEach(() => cleanup());

describe("Scenario: Version Select inputs stay within the modal width", () => {
  /** @scenario Version Select inputs stay within the modal width */
  it("renders version Select with flex layout props that prevent modal overflow", async () => {
    const longCommitMessage = "a".repeat(220);
    mockVersionsQuery.mockReturnValue({
      data: [
        { version: 1, versionId: "v1-id", commitMessage: "Short message" },
        { version: 2, versionId: "v2-id", commitMessage: longCommitMessage },
      ],
    });

    // The dialog portals its content out of the render container, so the rows
    // are only reachable from the document root.
    const { baseElement } = renderDialog();

    await waitFor(() => {
      expect(screen.getByLabelText("Production version")).toBeInTheDocument();
    });

    const selectRoots = baseElement.querySelectorAll('[data-testid="select-root"]');
    expect(selectRoots.length).toBeGreaterThan(0);
    selectRoots.forEach((root) => {
      expect(root).toHaveAttribute("data-flex", "1");
      expect(root).toHaveAttribute("data-max-width", "280px");
    });
  });
});
