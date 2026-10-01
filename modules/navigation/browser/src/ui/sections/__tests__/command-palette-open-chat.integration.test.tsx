/**
 * @vitest-environment jsdom
 * Spec: specs/support/crisp-bubble-suppression.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const emptyQuery = { data: undefined, isLoading: false };

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    agents: { getAll: { useQuery: () => emptyQuery } },
    workflow: { getAll: { useQuery: () => emptyQuery } },
  },
}));
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    prompts: { getAllPromptsForProject: { useQuery: () => emptyQuery } },
  },
}));

vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    dataset: { getAll: { useQuery: () => emptyQuery } },
  },
}));

vi.mock("@langwatch/evaluator-client", () => ({
  evaluatorClient: {
    evaluators: { getAll: { useQuery: () => emptyQuery } },
  },
}));

import { WithStubNavigationHost } from "../../../testing.tsx";
import { CommandPalette } from "../command-palette.tsx";

function renderPalette({ query }: { query: string }) {
  const openSupportChat = vi.fn();
  const onDone = vi.fn();
  const view = renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        deployment: { isSaaS: true },
        supportChat: { open: openSupportChat },
      }}
    >
      <CommandPalette
        surface="dialog"
        active={true}
        query={query}
        setQuery={() => undefined}
        onDone={onDone}
      />
    </WithStubNavigationHost>,
  );
  return { ...view, openSupportChat, onDone };
}

afterEach(() => {
  cleanup();
});

describe("the command palette's Open Chat entry", () => {
  describe("when the user selects Open Chat in the command palette", () => {
    /** @scenario Opening chat from the command palette shows the widget */
    it("opens the support chat and closes the palette", async () => {
      const { openSupportChat, onDone } = renderPalette({ query: "chat" });
      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText("Open Chat")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Open Chat"));

      expect(openSupportChat).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});
