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
    author: { name: "User 1" },
  },
  {
    id: "config-1",
    versionId: "version-2",
    handle: "test-prompt",
    version: 2,
    commitMessage: "Second version",
    author: { name: "User 1" },
  },
  {
    id: "config-1",
    versionId: "version-1",
    handle: "test-prompt",
    version: 1,
    commitMessage: "Initial version",
    author: { name: "User 1" },
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
    it("calls onRestoreSuccess with version data without making backend API call", async () => {
      const onRestoreSuccess = vi.fn().mockResolvedValue(undefined);

      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          onRestoreSuccess={onRestoreSuccess}
        />,
      );

      // Open the popover
      const historyButton = screen.getAllByTestId("version-history-button")[0]!;
      fireEvent.click(historyButton);

      // Wait for popover to open and find the restore button for v2
      await waitFor(() => {
        expect(
          screen.getByTestId("restore-version-button-2"),
        ).toBeInTheDocument();
      });

      // Click restore for version 2
      const restoreButton = screen.getByTestId("restore-version-button-2");
      fireEvent.click(restoreButton);

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

    it("does not call onRestoreSuccess for current version", async () => {
      const onRestoreSuccess = vi.fn();

      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          onRestoreSuccess={onRestoreSuccess}
        />,
      );

      // Open the popover
      const historyButton = screen.getAllByTestId("version-history-button")[0]!;
      fireEvent.click(historyButton);

      // Wait for popover to open
      await waitFor(() => {
        expect(screen.getByText("Prompt Version History")).toBeInTheDocument();
      });

      // Current version (v3) should not have a restore button
      expect(
        screen.queryByTestId("restore-version-button-3"),
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

      // Open the popover
      const historyButton = screen.getAllByTestId("version-history-button")[0]!;
      fireEvent.click(historyButton);

      // Wait for popover to open
      await waitFor(() => {
        expect(screen.getByText("Prompt Version History")).toBeInTheDocument();
      });

      // V3 (latest) should be marked as current - no restore button
      expect(
        screen.queryByTestId("restore-version-button-3"),
      ).not.toBeInTheDocument();
      // V2 should have restore button (not current)
      expect(
        screen.getByTestId("restore-version-button-2"),
      ).toBeInTheDocument();
      // V1 should have restore button (not current)
      expect(
        screen.getByTestId("restore-version-button-1"),
      ).toBeInTheDocument();
    });

    it("marks specified version as current when currentVersionId is provided", async () => {
      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          currentVersionId="version-2" // User is editing v2
        />,
      );

      // Open the popover
      const historyButton = screen.getAllByTestId("version-history-button")[0]!;
      fireEvent.click(historyButton);

      // Wait for popover to open
      await waitFor(() => {
        expect(screen.getByText("Prompt Version History")).toBeInTheDocument();
      });

      // V3 should have restore button (not current when editing v2)
      expect(
        screen.getByTestId("restore-version-button-3"),
      ).toBeInTheDocument();
      // V2 should be marked as current - no restore button
      expect(
        screen.queryByTestId("restore-version-button-2"),
      ).not.toBeInTheDocument();
      // V1 should have restore button (not current)
      expect(
        screen.getByTestId("restore-version-button-1"),
      ).toBeInTheDocument();
    });

    it("marks oldest version as current when editing v1", async () => {
      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          currentVersionId="version-1" // User is editing v1
        />,
      );

      // Open the popover
      const historyButton = screen.getAllByTestId("version-history-button")[0]!;
      fireEvent.click(historyButton);

      // Wait for popover to open
      await waitFor(() => {
        expect(screen.getByText("Prompt Version History")).toBeInTheDocument();
      });

      // V3 should have restore button (not current)
      expect(
        screen.getByTestId("restore-version-button-3"),
      ).toBeInTheDocument();
      // V2 should have restore button (not current)
      expect(
        screen.getByTestId("restore-version-button-2"),
      ).toBeInTheDocument();
      // V1 should be marked as current - no restore button
      expect(
        screen.queryByTestId("restore-version-button-1"),
      ).not.toBeInTheDocument();
    });

    it("shows 'current' tag on the version being edited", async () => {
      renderWithChakra(
        <VersionHistoryListPopover
          configId="config-1"
          currentVersionId="version-2" // User is editing v2
        />,
      );

      // Open the popover
      const historyButton = screen.getAllByTestId("version-history-button")[0]!;
      fireEvent.click(historyButton);

      // Wait for popover to open
      await waitFor(() => {
        expect(screen.getByText("Prompt Version History")).toBeInTheDocument();
      });

      // Should show "current" tag - only one should exist (for v2)
      const currentTags = screen.getAllByText("current");
      expect(currentTags).toHaveLength(1);
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

  describe("author of a version", () => {
    const openPopover = async () => {
      const historyButton = screen.getAllByTestId("version-history-button")[0]!;
      fireEvent.click(historyButton);
      await waitFor(() => {
        expect(screen.getByText("Prompt Version History")).toBeInTheDocument();
      });
    };

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
          renderWithAuthor({ id: "u1", name: null, email: "grace@example.com" });
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
