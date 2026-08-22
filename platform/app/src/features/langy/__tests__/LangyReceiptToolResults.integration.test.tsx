/**
 * @vitest-environment jsdom
 *
 * A receipt row opens to show what the tool returned. The receipt names what
 * ran; the result is what the model actually read, and debugging "why did it
 * conclude that?" is unanswerable without it. Rows whose calls recorded no
 * result do not pretend to open, and a failed call's result is its error text.
 *
 * Boundary mocks mirror LangyReasoningTitleGrouping.integration.test.tsx.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({}),
    dashboards: {
      getAll: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    graphs: { create: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

import { MessageContent } from "../components/MessageContent";

afterEach(cleanup);

function assistantMessage(parts: unknown[]): UIMessage {
  return {
    id: "m-assistant",
    role: "assistant",
    parts,
  } as unknown as UIMessage;
}

function renderMessage(message: UIMessage) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={message}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
      />
    </ChakraProvider>,
  );
}

const OUTPUT = "total 42 traces in the last day";

describe("the completed receipt's tool results", () => {
  describe("when a row's call recorded a result", () => {
    /** @scenario A receipt row opens to show what the tool returned */
    it("opens on click and shows what the tool returned", () => {
      renderMessage(
        assistantMessage([
          {
            type: "tool-grep",
            toolCallId: "call-1",
            state: "output-available",
            input: { pattern: "traces" },
            output: OUTPUT,
          },
          {
            type: "tool-webfetch",
            toolCallId: "call-2",
            state: "output-available",
            input: { url: "https://example.com" },
            output: "ok",
          },
          { type: "text", text: "There are 42.", role: "assistant" },
        ]),
      );

      expect(screen.queryByText(OUTPUT)).toBeNull();
      const rowButtons = screen
        .getAllByRole("listitem")
        .flatMap((item) => within(item).queryAllByRole("button"));
      expect(rowButtons.length).toBeGreaterThan(0);
      for (const button of rowButtons) fireEvent.click(button);
      expect(screen.getByText(OUTPUT)).toBeDefined();
      expect(screen.getByText("ok")).toBeDefined();
    });
  });

  describe("when a row's calls recorded no result", () => {
    it("offers nothing to open", () => {
      renderMessage(
        assistantMessage([
          {
            type: "tool-grep",
            toolCallId: "call-1",
            state: "output-available",
            input: { pattern: "traces" },
          },
          { type: "text", text: "Done.", role: "assistant" },
        ]),
      );

      const rows = screen.getAllByRole("listitem");
      for (const item of rows) {
        expect(within(item).queryByRole("button")).toBeNull();
      }
    });
  });
});
