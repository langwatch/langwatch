/**
 * @vitest-environment jsdom
 *
 * The Conversation Context panel carries a panel-level Translate toggle: it
 * translates every visible turn preview to English at once and flips back on
 * "Show original". Renders the real ConversationContext with the real
 * useTextTranslation hook; only the tRPC boundary is mocked.
 * See specs/traces-v2/message-translation.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../stores/drawerStore", () => ({
  useDrawerStore: (selector: (s: { viewMode: string }) => unknown) =>
    selector({ viewMode: "summary" }),
}));

vi.mock("../../../hooks/useTraceDrawerNavigation", () => ({
  useTraceDrawerNavigation: () => ({ navigateToTrace: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

const translateMock = vi.fn(
  async ({ textToTranslate }: { textToTranslate: string }) => ({
    translation: `EN::${textToTranslate}`,
  }),
);

vi.mock("~/utils/api", () => ({
  api: {
    translate: {
      translate: {
        useMutation: () => ({ mutateAsync: translateMock, isLoading: false }),
      },
    },
  },
}));

const turnsState = {
  conversationId: "conv_1",
  total: 2,
  position: 2,
  turns: [],
  previous: {
    traceId: "trace_prev",
    timestamp: 1,
    name: "prev",
    rootSpanType: null,
    status: "ok",
    input: "pregunta previa",
    output: "respuesta previa",
    inputRedacted: false,
    outputRedacted: false,
    inputVisibleTo: null,
    outputVisibleTo: null,
  },
  next: null,
  isLoading: false,
};

vi.mock("../../../hooks/useConversationContext", () => ({
  useConversationContext: () => ({
    ...turnsState,
    turns: [turnsState.previous, current()],
    current: current(),
  }),
}));

function current() {
  return {
    traceId: "trace_1",
    timestamp: 2,
    name: "curr",
    rootSpanType: null,
    status: "ok",
    input: "pregunta actual",
    output: "respuesta actual",
    inputRedacted: false,
    outputRedacted: false,
    inputVisibleTo: null,
    outputVisibleTo: null,
  };
}

import { ConversationContext } from "../ConversationContext";

function renderStrip() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ConversationContext
        conversationId="conv_1"
        traceId="trace_1"
        collapsed={false}
        onToggleCollapsed={() => undefined}
      />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  translateMock.mockClear();
});

describe("Conversation Context translate", () => {
  describe("when the panel is expanded with turn content", () => {
    it("shows a Translate action", () => {
      renderStrip();
      expect(
        screen.getByRole("button", { name: /translate/i }),
      ).toBeInTheDocument();
    });

    it("translates the visible previews and flips back on Show original", async () => {
      const user = userEvent.setup();
      renderStrip();
      expect(screen.getByText("pregunta actual")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /translate/i }));

      await waitFor(() => {
        expect(screen.getByText("EN::pregunta actual")).toBeInTheDocument();
      });
      expect(translateMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        textToTranslate: "pregunta actual",
      });

      await user.click(screen.getByRole("button", { name: /show original/i }));
      expect(screen.getByText("pregunta actual")).toBeInTheDocument();
      expect(screen.queryByText("EN::pregunta actual")).not.toBeInTheDocument();
    });
  });
});
