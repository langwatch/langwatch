/**
 * @vitest-environment jsdom
 * The version-history panel: what each row says, which one is marked current, how another
 * version is loaded, and how a version is compared with the one before it.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { Temporal } from "@langwatch/time";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WireVersionedPrompt } from "../../../../../model/wire-versioned-prompt.ts";

const succeeded = vi.hoisted(() => vi.fn());
const failed = vi.hoisted(() => vi.fn());

vi.mock("../../../../../model/prompt-host.ts", () => ({
  usePromptHost: () => ({ succeeded, failed }),
}));
vi.mock("../../../../../behavior/use-prompt-project.ts", () => ({
  usePromptProject: () => ({ project: { id: "test-project" } }),
}));

function versionedPrompt(overrides: Partial<WireVersionedPrompt>): WireVersionedPrompt {
  return {
    id: "config-1",
    name: "test-prompt",
    handle: "test-prompt",
    scope: "PROJECT",
    version: 1,
    versionId: "version-1",
    versionCreatedAt: "2026-08-18T09:00:00.000Z",
    model: "openai/gpt-5-mini",
    prompt: "",
    projectId: "test-project",
    organizationId: "test-organization",
    messages: [{ role: "system", content: "You are a helpful assistant." }],
    authorId: "user-1",
    author: { id: "user-1", name: "User 1", email: null, image: null },
    inputs: [],
    outputs: [],
    commitMessage: "Initial version",
    updatedAt: "2026-08-18T09:00:00.000Z",
    createdAt: "2026-08-18T09:00:00.000Z",
    tags: [],
    parameters: {},
    ...overrides,
  };
}

const mockVersions: WireVersionedPrompt[] = [
  versionedPrompt({
    versionId: "version-3",
    version: 3,
    commitMessage: "Latest version",
    versionCreatedAt: "2026-08-20T09:00:00.000Z",
    messages: [{ role: "system", content: "You are a terse assistant." }],
  }),
  versionedPrompt({
    versionId: "version-2",
    version: 2,
    commitMessage: "Second version",
    versionCreatedAt: "2026-08-19T09:00:00.000Z",
  }),
  versionedPrompt({ model: "anthropic/claude-haiku-4-5" }),
];

const { mockUseQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
}));

vi.mock("../../../../../behavior/prompt-api.ts", () => ({
  promptApi: {
    prompts: {
      getAllVersionsForPrompt: {
        useQuery: mockUseQuery,
      },
    },
  },
}));

// Import after mocks
import { VersionHistoryListPopover } from "../version-history-list-popover.tsx";

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

const openPopover = async () => {
  const historyButton = screen.getAllByTestId("version-history-button")[0]!;
  fireEvent.click(historyButton);
  await waitFor(() => {
    expect(screen.getByText("Version history")).toBeInTheDocument();
  });
};

/** The one action a version row offers lives behind its overflow menu. */
const chooseLoadVersion = async (version: number) => {
  const user = userEvent.setup();
  await user.click(screen.getByTestId(`version-actions-button-${version}`));
  const item = await screen.findByTestId(`restore-version-button-${version}`);
  await user.click(item);
};

describe("VersionHistoryListPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({
      data: mockVersions,
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when loading a previous version", () => {
    /** @scenario "Loading another version is one deliberate choice" */
    it("calls onRestoreSuccess with version data without making backend API call", async () => {
      const onRestoreSuccess = vi.fn().mockResolvedValue(undefined);

      renderWithChakra(
        <VersionHistoryListPopover configId="config-1" onRestoreSuccess={onRestoreSuccess} />,
      );

      await openPopover();
      await chooseLoadVersion(2);

      // Should call onRestoreSuccess with the version 2 data
      await waitFor(() => {
        expect(onRestoreSuccess).toHaveBeenCalledWith(
          expect.objectContaining({
            versionId: "version-2",
            version: 2,
            commitMessage: "Second version",
          }),
        );
      });

      // Should show info toast (not success toast about "restored")
      expect(succeeded).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Restored prompt to version 2",
        }),
      );
    });

    it("does not offer to load the version already open", async () => {
      const onRestoreSuccess = vi.fn();

      renderWithChakra(
        <VersionHistoryListPopover configId="config-1" onRestoreSuccess={onRestoreSuccess} />,
      );

      await openPopover();

      // Current version (v3) offers no actions of its own
      expect(screen.queryByTestId("version-actions-button-3")).not.toBeInTheDocument();
      expect(onRestoreSuccess).not.toHaveBeenCalled();
    });
  });

  describe("given the currentVersionId prop", () => {
    it("marks latest version as current when currentVersionId is not provided", async () => {
      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          // No currentVersionId - should default to latest (v3)
        />,
      );

      await openPopover();

      // V3 (latest) should be marked as current - no actions
      expect(screen.queryByTestId("version-actions-button-3")).not.toBeInTheDocument();
      // V2 and V1 can be loaded
      expect(screen.getByTestId("version-actions-button-2")).toBeInTheDocument();
      expect(screen.getByTestId("version-actions-button-1")).toBeInTheDocument();
    });

    /** @scenario "The version the editor is on is marked as current" */
    it("marks specified version as current when currentVersionId is provided", async () => {
      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          currentVersionId="version-2" // User is editing v2
        />,
      );

      await openPopover();

      expect(screen.getByTestId("version-actions-button-3")).toBeInTheDocument();
      expect(screen.queryByTestId("version-actions-button-2")).not.toBeInTheDocument();
      expect(screen.getByTestId("version-actions-button-1")).toBeInTheDocument();
      expect(screen.getAllByText("Current")).toHaveLength(1);
    });

    it("marks oldest version as current when editing v1", async () => {
      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          currentVersionId="version-1" // User is editing v1
        />,
      );

      await openPopover();

      expect(screen.getByTestId("version-actions-button-3")).toBeInTheDocument();
      expect(screen.getByTestId("version-actions-button-2")).toBeInTheDocument();
      expect(screen.queryByTestId("version-actions-button-1")).not.toBeInTheDocument();
    });
  });

  describe("when the popover is closed", () => {
    it("does not enable the version history query", () => {
      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);

      expect(mockUseQuery).toHaveBeenCalledWith(
        expect.objectContaining({ idOrHandle: "config-1" }),
        expect.objectContaining({ enabled: false }),
      );
    });
  });

  describe("when the popover is opened", () => {
    it("enables the version history query", async () => {
      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);

      const historyButton = screen.getAllByTestId("version-history-button")[0]!;
      fireEvent.click(historyButton);

      await waitFor(() => {
        expect(mockUseQuery).toHaveBeenLastCalledWith(
          expect.objectContaining({ idOrHandle: "config-1" }),
          expect.objectContaining({ enabled: true }),
        );
      });
    });
  });

  describe("when a version was saved", () => {
    /** @scenario "Each version says when it was saved" */
    it("shows how long ago each version was saved", async () => {
      const savedAt = Temporal.Now.instant().subtract({ hours: 3 }).toString();
      mockUseQuery.mockReturnValue({
        data: [versionedPrompt({ versionCreatedAt: savedAt })],
        isLoading: false,
      });

      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);
      await openPopover();

      const relative = screen.getByText(/hours ago/);
      // The exact moment stays reachable without cluttering the row.
      expect(relative).toHaveAttribute(
        "aria-label",
        `Saved ${Temporal.Instant.from(savedAt).toLocaleString()}`,
      );
    });

    it("omits the time when the version carries none", async () => {
      mockUseQuery.mockReturnValue({
        data: [
          {
            id: "config-1",
            versionId: "version-1",
            version: 1,
            commitMessage: "Initial version",
            author: { name: "User 1" },
          },
        ],
        isLoading: false,
      });

      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);
      await openPopover();

      expect(screen.getByText("Initial version")).toBeInTheDocument();
      expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
    });
  });

  describe("given the editor has unsaved changes", () => {
    /** @scenario "Discarding unsaved edits is offered above the list, not beside a version" */
    it("offers to discard them once, above the list", async () => {
      const onRestoreSuccess = vi.fn().mockResolvedValue(undefined);

      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          hasUnsavedChanges={true}
          onRestoreSuccess={onRestoreSuccess}
        />,
      );

      await openPopover();

      expect(screen.getByText("You have unsaved changes")).toBeInTheDocument();
      const discardButtons = screen.getAllByTestId("discard-local-changes-button");
      expect(discardButtons).toHaveLength(1);

      fireEvent.click(discardButtons[0]!);

      // Discarding reloads the version the editor is based on.
      await waitFor(() => {
        expect(onRestoreSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ versionId: "version-3" }),
        );
      });
      expect(succeeded).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Discarded changes" }),
      );
    });

    /** @scenario "The panel is quiet when there is nothing unsaved" */
    it("says nothing about discarding when there are none", async () => {
      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);

      await openPopover();

      expect(screen.queryByTestId("discard-local-changes-button")).not.toBeInTheDocument();
    });
  });

  describe("when a version is compared with the one before it", () => {
    /** @scenario "A version shows what it changed from the version before it" */
    it("shows the words removed and the words added", async () => {
      const user = userEvent.setup();
      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);
      await openPopover();

      await user.click(screen.getByTestId("version-changes-toggle-3"));

      const changes = await screen.findByTestId("version-changes-3");
      expect(changes).toHaveTextContent("System prompt");
      expect(changes).toHaveTextContent("helpful");
      expect(changes).toHaveTextContent("terse");
    });

    it("reports a changed model as a setting", async () => {
      const user = userEvent.setup();
      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);
      await openPopover();

      await user.click(screen.getByTestId("version-changes-toggle-2"));

      const changes = await screen.findByTestId("version-changes-2");
      expect(changes).toHaveTextContent("Model");
      expect(changes).toHaveTextContent("anthropic/claude-haiku-4-5");
      expect(changes).toHaveTextContent("openai/gpt-5-mini");
    });

    /** @scenario "The oldest version offers no comparison" */
    it("offers no comparison on the oldest version", async () => {
      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);
      await openPopover();

      expect(screen.getByTestId("version-changes-toggle-3")).toBeInTheDocument();
      expect(screen.queryByTestId("version-changes-toggle-1")).not.toBeInTheDocument();
    });
  });
});
