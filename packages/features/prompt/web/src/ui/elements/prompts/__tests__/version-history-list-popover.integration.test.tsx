/**
 * @vitest-environment jsdom
 *
 * The version history popover's author row: an avatar and a display label
 * that falls back name -> email -> "Unknown author", with a tooltip that
 * always names who (or what) created the version.
 *
 * @see specs/prompts/prompt-version-history-author.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { VersionHistoryListPopover } from "../version-history-list-popover";

vi.mock("@langwatch/workflow-web/studio-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj_1" } }),
}));
vi.mock("@langwatch/workflow-web/studio-host/toaster", () => ({
  toaster: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("@langwatch/workflow-web/studio-host/errors", () => ({ showErrorToast: vi.fn() }));

const mockUseQuery = vi.fn();
vi.mock("@langwatch/workflow-web/studio-host/api", () => ({
  api: { prompts: { getAllVersionsForPrompt: { useQuery: (...args: unknown[]) => mockUseQuery(...args) } } },
}));

type Author = { name: string | null; email?: string | null; image?: string | null } | null;

const versionWithAuthor = (author: Author) =>
  [
    {
      id: "config-1",
      versionId: "version-1",
      version: 1,
      commitMessage: "Initial version",
      author,
    },
  ] as unknown as VersionedPrompt[];

const renderWithAuthor = async (author: Author) => {
  mockUseQuery.mockReturnValue({ data: versionWithAuthor(author), isLoading: false });
  render(
    <ChakraProvider value={defaultSystem}>
      <VersionHistoryListPopover configId="config-1" />
    </ChakraProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByTestId("version-history-button"));
};

const hover = (element: HTMLElement) => {
  fireEvent.pointerEnter(element, { pointerType: "mouse" });
  fireEvent.pointerMove(element, { pointerType: "mouse" });
};

describe("VersionHistoryListPopover author display", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given the author has a display name", () => {
    /** @scenario "Author with a display name is shown by name" */
    it("shows the author's name", async () => {
      await renderWithAuthor({ name: "Ada Lovelace", email: "ada@example.com" });

      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    });
  });

  describe("given the author has no display name", () => {
    /** @scenario "Author without a display name falls back to their email" */
    it("shows the author's email instead", async () => {
      await renderWithAuthor({ name: null, email: "grace@example.com" });

      expect(screen.getByText("grace@example.com")).toBeInTheDocument();
    });
  });

  describe("given the version has no author on record", () => {
    /** @scenario "Version created outside the app shows Unknown author" */
    it("labels the row 'Unknown author'", async () => {
      await renderWithAuthor(null);

      expect(screen.getByText("Unknown author")).toBeInTheDocument();
    });

    it("explains in a tooltip that no author was recorded", async () => {
      await renderWithAuthor(null);

      hover(screen.getByText("Unknown author"));

      await waitFor(
        () =>
          expect(
            screen.getAllByText("No author recorded for this version").length,
          ).toBeGreaterThan(0),
        { timeout: 3000 },
      );
    });
  });

  describe("given the author signed in with a profile photo", () => {
    /** @scenario "A signed-in author's profile photo is used as the avatar" */
    it("shows the photo as the avatar", async () => {
      await renderWithAuthor({
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: "https://example.com/ada.png",
      });

      expect(document.querySelector('img[src="https://example.com/ada.png"]')).not.toBeNull();
    });
  });
});
