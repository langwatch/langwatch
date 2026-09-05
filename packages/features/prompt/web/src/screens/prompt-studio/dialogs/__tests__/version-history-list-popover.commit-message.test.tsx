/**
 * @vitest-environment jsdom
 * @see specs/prompts/prompt-version-detail-visibility.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockHost = { succeeded: vi.fn(), failed: vi.fn() };
vi.mock("../../../../model/prompt-host", () => ({
  usePromptHost: () => mockHost,
}));

vi.mock("../../../../behavior/use-prompt-project", () => ({
  usePromptProject: () => ({ project: { id: "project-1" } }),
}));

const mockVersionsQuery = vi.fn();
vi.mock("../../../../behavior/prompt-api", () => ({
  promptApi: {
    prompts: {
      getAllVersionsForPrompt: { useQuery: () => mockVersionsQuery() },
      restoreVersion: { useMutation: () => ({ mutateAsync: vi.fn(), isLoading: false }) },
    },
  },
}));

import { VersionHistoryListPopover } from "../version-history-list-popover";

function renderPopover() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <VersionHistoryListPopover configId="config-1" initialOpen />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("<VersionHistoryListPopover/> commit message", () => {
  describe("given the commit message is long", () => {
    describe("when displaying the version history", () => {
      /** @scenario "A long commit message is shown in full" */
      it("renders the full message text", async () => {
        const longMessage =
          "Lowered temperature to reduce hallucination rate on the summarizer step, per eval run #82, and switched to the mini model to cut latency";

        mockVersionsQuery.mockReturnValue({
          data: [
            {
              id: "config-1",
              versionId: "version-1",
              version: 1,
              commitMessage: longMessage,
              author: { name: "User 1" },
            },
          ],
          isLoading: false,
        });

        renderPopover();

        expect(await screen.findByText(longMessage)).toBeInTheDocument();
      });
    });
  });
});
