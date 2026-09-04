/**
 * @vitest-environment jsdom
 *
 * Selecting the "Open Chat" entry in the command palette hands control
 * straight to the host's support chat and closes the palette. The palette
 * only lists the command on a SaaS deployment (see use-filtered-commands.ts).
 *
 * Spec: specs/support/crisp-bubble-suppression.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const emptyQuery = { data: undefined, isLoading: false };

vi.mock("../../../behavior/navigation-api", () => ({
  navigationApi: {
    prompts: { getAllPromptsForProject: { useQuery: () => emptyQuery } },
    agents: { getAll: { useQuery: () => emptyQuery } },
    dataset: { getAll: { useQuery: () => emptyQuery } },
    workflow: { getAll: { useQuery: () => emptyQuery } },
    evaluators: { getAll: { useQuery: () => emptyQuery } },
  },
}));

import { WithStubNavigationHost } from "../../../testing";
import { CommandPalette } from "../command-palette";

function renderPalette({ query }: { query: string }) {
  const openSupportChat = vi.fn();
  const onDone = vi.fn();
  const view = render(
    <ChakraProvider value={defaultSystem}>
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
      </WithStubNavigationHost>
    </ChakraProvider>,
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
