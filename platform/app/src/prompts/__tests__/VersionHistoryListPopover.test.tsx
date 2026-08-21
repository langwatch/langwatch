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
import type { VersionedPrompt } from "~/server/prompt-config";

// Mock dependencies
const mockProject = { id: "test-project" };
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: mockProject }),
}));

// Mock API - partial versions for testing (full type not needed for this test)
const mockVersions = [
  {
    id: "config-1",
    versionId: "version-3",
    handle: "test-prompt",
    version: 3,
    commitMessage: "Latest version",
    versionCreatedAt: new Date("2026-08-20T09:00:00.000Z"),
    author: { name: "User 1" },
    model: "openai/gpt-5-mini",
    messages: [{ role: "system", content: "You are a terse assistant." }],
  },
  {
    id: "config-1",
    versionId: "version-2",
    handle: "test-prompt",
    version: 2,
    commitMessage: "Second version",
    versionCreatedAt: new Date("2026-08-19T09:00:00.000Z"),
    author: { name: "User 1" },
    model: "openai/gpt-5-mini",
    messages: [{ role: "system", content: "You are a helpful assistant." }],
  },
  {
    id: "config-1",
    versionId: "version-1",
    handle: "test-prompt",
    version: 1,
    commitMessage: "Initial version",
    versionCreatedAt: new Date("2026-08-18T09:00:00.000Z"),
    author: { name: "User 1" },
    model: "openai/gpt-4.1",
    messages: [{ role: "system", content: "You are a helpful assistant." }],
  },
] as unknown as VersionedPrompt[];

const { mockUseQuery } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    prompts: {
      getAllVersionsForPrompt: {
        useQuery: mockUseQuery,
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { toaster } from "~/components/ui/toaster";
// Import after mocks
import { VersionHistoryListPopover } from "../VersionHistoryListPopover";

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
        <VersionHistoryListPopover
          configId="config-1"
          onRestoreSuccess={onRestoreSuccess}
        />,
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
      expect(toaster.info).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Restored prompt to version 2",
        }),
      );
    });

    it("does not offer to load the version already open", async () => {
      const onRestoreSuccess = vi.fn();

      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          onRestoreSuccess={onRestoreSuccess}
        />,
      );

      await openPopover();

      // Current version (v3) offers no actions of its own
      expect(
        screen.queryByTestId("version-actions-button-3"),
      ).not.toBeInTheDocument();
      expect(onRestoreSuccess).not.toHaveBeenCalled();
    });
  });

  describe("currentVersionId prop", () => {
    it("marks latest version as current when currentVersionId is not provided", async () => {
      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          // No currentVersionId - should default to latest (v3)
        />,
      );

      await openPopover();

      // V3 (latest) should be marked as current - no actions
      expect(
        screen.queryByTestId("version-actions-button-3"),
      ).not.toBeInTheDocument();
      // V2 and V1 can be loaded
      expect(
        screen.getByTestId("version-actions-button-2"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("version-actions-button-1"),
      ).toBeInTheDocument();
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

      expect(
        screen.getByTestId("version-actions-button-3"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("version-actions-button-2"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("version-actions-button-1"),
      ).toBeInTheDocument();
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

      expect(
        screen.getByTestId("version-actions-button-3"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("version-actions-button-2"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("version-actions-button-1"),
      ).not.toBeInTheDocument();
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
      const savedAt = new Date(Date.now() - 1000 * 60 * 60 * 3);
      mockUseQuery.mockReturnValue({
        data: [
          {
            id: "config-1",
            versionId: "version-1",
            version: 1,
            commitMessage: "Initial version",
            versionCreatedAt: savedAt,
            author: { name: "User 1" },
          },
        ] as unknown as VersionedPrompt[],
        isLoading: false,
      });

      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);
      await openPopover();

      const relative = screen.getByText(/hours ago/);
      // The exact moment stays reachable without cluttering the row.
      expect(relative).toHaveAttribute(
        "aria-label",
        `Saved ${savedAt.toLocaleString()}`,
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
        ] as unknown as VersionedPrompt[],
        isLoading: false,
      });

      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);
      await openPopover();

      expect(screen.getByText("Initial version")).toBeInTheDocument();
      expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
    });
  });

  describe("unsaved changes", () => {
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
      const discardButtons = screen.getAllByTestId(
        "discard-local-changes-button",
      );
      expect(discardButtons).toHaveLength(1);

      fireEvent.click(discardButtons[0]!);

      // Discarding reloads the version the editor is based on.
      await waitFor(() => {
        expect(onRestoreSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ versionId: "version-3" }),
        );
      });
    });

    /** @scenario "The panel is quiet when there is nothing unsaved" */
    it("says nothing about discarding when there are none", async () => {
      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);

      await openPopover();

      expect(
        screen.queryByTestId("discard-local-changes-button"),
      ).not.toBeInTheDocument();
    });
  });

  describe("what a version changed", () => {
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
      expect(changes).toHaveTextContent("openai/gpt-4.1");
      expect(changes).toHaveTextContent("openai/gpt-5-mini");
    });

    /** @scenario "The oldest version offers no comparison" */
    it("offers no comparison on the oldest version", async () => {
      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);
      await openPopover();

      expect(
        screen.getByTestId("version-changes-toggle-3"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("version-changes-toggle-1"),
      ).not.toBeInTheDocument();
    });
  });

  describe("commit message of a version", () => {
    describe("given the commit message is long", () => {
      describe("when displaying the version history", () => {
        /** @scenario "A long commit message is shown in full" */
        it("renders the full message text", async () => {
          const longMessage =
            "Lowered temperature to reduce hallucination rate on the summarizer step, per eval run #82, and switched to the mini model to cut latency";

          mockUseQuery.mockReturnValue({
            data: [
              {
                id: "config-1",
                versionId: "version-1",
                version: 1,
                commitMessage: longMessage,
                author: { name: "User 1" },
              },
            ] as unknown as VersionedPrompt[],
            isLoading: false,
          });

          renderWithChakra(<VersionHistoryListPopover configId="config-1" />);
          await openPopover();

          const messageEl = screen.getByText(longMessage);
          // Full-text presence is supplementary: the DOM keeps the whole
          // string even under a 1-line clamp, so it alone can't prove the
          // text isn't visually cut off. Assert the clamp actually applied
          // is the generous multi-line bound, not the single-line clamp
          // that caused the "2-3 words" bug.
          const style = getComputedStyle(messageEl);
          expect(style.getPropertyValue("-webkit-line-clamp")).toBe("8");
          expect(style.getPropertyValue("overflow")).toBe("hidden");
        });
      });
    });
  });

  describe("author of a version", () => {
    const renderWithAuthor = (author: unknown) => {
      mockUseQuery.mockReturnValue({
        data: [
          {
            id: "config-1",
            versionId: "version-1",
            version: 1,
            commitMessage: "Initial version",
            author,
          },
        ] as unknown as VersionedPrompt[],
        isLoading: false,
      });
      renderWithChakra(<VersionHistoryListPopover configId="config-1" />);
    };

    // Chakra tooltips open on a pointer gesture; pointerMove bubbles to the
    // trigger so zag registers the hover.
    const hover = (element: HTMLElement) => {
      fireEvent.pointerEnter(element, { pointerType: "mouse" });
      fireEvent.pointerMove(element, { pointerType: "mouse" });
    };

    describe("given the author has a display name", () => {
      describe("when displaying the version history", () => {
        /** @scenario "Author with a display name is shown by name" */
        it("shows the author's name", async () => {
          renderWithAuthor({
            id: "u1",
            name: "Ada Lovelace",
            email: "ada@example.com",
          });
          await openPopover();

          expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
        });

        it("reveals the author's name and email in a tooltip on hover", async () => {
          renderWithAuthor({
            id: "u1",
            name: "Ada Lovelace",
            email: "ada@example.com",
          });
          await openPopover();

          hover(screen.getByText("Ada Lovelace"));

          await waitFor(
            () =>
              expect(
                screen.getAllByText("ada@example.com").length,
              ).toBeGreaterThan(0),
            { timeout: 3000 },
          );
        });
      });
    });

    describe("given the author has no display name", () => {
      describe("when displaying the version history", () => {
        /** @scenario "Author without a display name falls back to their email" */
        it("shows the author's email instead", async () => {
          renderWithAuthor({
            id: "u1",
            name: null,
            email: "grace@example.com",
          });
          await openPopover();

          expect(screen.getByText("grace@example.com")).toBeInTheDocument();
        });
      });
    });

    describe("given the version has no author on record", () => {
      describe("when displaying the version history", () => {
        /** @scenario "Version created outside the app shows Unknown author" */
        it("labels the row 'Unknown author'", async () => {
          renderWithAuthor(null);
          await openPopover();

          expect(screen.getByText("Unknown author")).toBeInTheDocument();
        });

        it("explains in a tooltip that no author was recorded", async () => {
          renderWithAuthor(null);
          await openPopover();

          hover(screen.getByText("Unknown author"));

          await waitFor(
            () =>
              expect(
                screen.getAllByText("No author recorded for this version")
                  .length,
              ).toBeGreaterThan(0),
            { timeout: 3000 },
          );
        });
      });
    });

    describe("given the author signed in with a profile photo", () => {
      describe("when displaying the version history", () => {
        /** @scenario "A signed-in author's profile photo is used as the avatar" */
        it("shows the photo as the avatar", async () => {
          renderWithAuthor({
            id: "u1",
            name: "Ada Lovelace",
            email: "ada@example.com",
            image: "https://example.com/ada.png",
          });
          await openPopover();

          expect(
            document.querySelector('img[src="https://example.com/ada.png"]'),
          ).not.toBeNull();
        });
      });
    });
  });
});
