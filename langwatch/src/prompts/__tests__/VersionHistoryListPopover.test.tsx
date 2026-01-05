/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
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

vi.mock("~/utils/api", () => ({
  api: {
    prompts: {
      getAllVersionsForPrompt: {
        useQuery: () => ({
          data: mockVersions,
          isLoading: false,
        }),
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

// Import after mocks
import { VersionHistoryListPopover } from "../VersionHistoryListPopover";
import { toaster } from "~/components/ui/toaster";

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("VersionHistoryListPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        expect(screen.getByTestId("restore-version-button-2")).toBeInTheDocument();
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
          title: "Loaded v2",
          description: "Click 'Update' to save the restored version",
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
      expect(screen.queryByTestId("restore-version-button-3")).not.toBeInTheDocument();
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
      expect(screen.queryByTestId("restore-version-button-3")).not.toBeInTheDocument();
      // V2 should have restore button (not current)
      expect(screen.getByTestId("restore-version-button-2")).toBeInTheDocument();
      // V1 should have restore button (not current)
      expect(screen.getByTestId("restore-version-button-1")).toBeInTheDocument();
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
      expect(screen.getByTestId("restore-version-button-3")).toBeInTheDocument();
      // V2 should be marked as current - no restore button
      expect(screen.queryByTestId("restore-version-button-2")).not.toBeInTheDocument();
      // V1 should have restore button (not current)
      expect(screen.getByTestId("restore-version-button-1")).toBeInTheDocument();
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
      expect(screen.getByTestId("restore-version-button-3")).toBeInTheDocument();
      // V2 should have restore button (not current)
      expect(screen.getByTestId("restore-version-button-2")).toBeInTheDocument();
      // V1 should be marked as current - no restore button
      expect(screen.queryByTestId("restore-version-button-1")).not.toBeInTheDocument();
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
});
