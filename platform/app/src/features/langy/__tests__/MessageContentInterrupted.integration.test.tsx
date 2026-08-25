/**
 * @vitest-environment jsdom
 *
 * An assistant reply with nothing visible renders a quiet empty state. When
 * THIS browser stopped the turn (ADR-078), that state must say "Interrupted"
 * rather than "No content": the user halted the answer two seconds ago, and
 * "No content" reads like the panel lost it. The store carries the fact as
 * `interruptedConversationId` — set by a dispatched stop, cleared by the next
 * send — and the panel forwards it for the trailing assistant message.
 *
 * Boundary mocks match LangyReasoningTitleGrouping.integration.test.tsx: the
 * derived-card renderers load the router, project hook, tRPC client and
 * recharts transitively.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { cloneElement, type ReactElement } from "react";
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

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 200 }),
  };
});

import { MessageContent } from "../components/MessageContent";
import { useLangyStore } from "../stores/langyStore";

afterEach(cleanup);

const emptyAssistantMessage = {
  id: "m-assistant",
  role: "assistant",
  parts: [],
} as unknown as UIMessage;

const partialAssistantMessage = {
  id: "m-assistant-partial",
  role: "assistant",
  parts: [{ type: "text", text: "The slowest traces are" }],
} as unknown as UIMessage;

function renderMessage({
  interrupted,
  message = emptyAssistantMessage,
}: {
  interrupted: boolean;
  message?: UIMessage;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MessageContent
        message={message}
        appliedOutcomes={{}}
        discardedProposals={new Set()}
        applyingProposals={new Set()}
        onApply={async () => {}}
        onDiscard={() => {}}
        interrupted={interrupted}
      />
    </ChakraProvider>,
  );
}

describe("given a settled assistant reply with nothing visible", () => {
  describe("when this browser stopped the turn", () => {
    /** @scenario A stop before any words arrive reads as interrupted, not as missing content */
    it("says Interrupted instead of No content", () => {
      renderMessage({ interrupted: true });

      expect(screen.getByText("Interrupted")).toBeInTheDocument();
      expect(screen.queryByText("No content")).toBeNull();
    });
  });

  describe("when the emptiness has another cause", () => {
    it("keeps the plain empty state", () => {
      renderMessage({ interrupted: false });

      expect(screen.getByText("No content")).toBeInTheDocument();
    });
  });
});

describe("given a settled assistant reply that had started to answer", () => {
  describe("when this browser stopped the turn", () => {
    /** @scenario A stopped reply says so, whatever it managed to say first */
    it("keeps what arrived and marks the reply interrupted", () => {
      renderMessage({ interrupted: true, message: partialAssistantMessage });

      expect(screen.getByText(/The slowest traces are/)).toBeInTheDocument();
      expect(screen.getByText("Interrupted")).toBeInTheDocument();
    });
  });

  describe("when the reply finished on its own", () => {
    it("marks nothing", () => {
      renderMessage({ interrupted: false, message: partialAssistantMessage });

      expect(screen.queryByText("Interrupted")).toBeNull();
    });
  });
});

describe("the store's interruption record", () => {
  afterEach(() =>
    useLangyStore.setState({
      turnPhase: "idle",
      activeTurnId: null,
      activeConversationId: null,
      interruptedConversationId: null,
    }),
  );

  describe("when a stop is dispatched on an active turn", () => {
    it("remembers which conversation was interrupted until the next send", () => {
      useLangyStore.setState({
        activeConversationId: "conv-1",
        turnPhase: "active",
        activeTurnId: "turn-1",
      });

      useLangyStore.getState().requestStop();
      expect(useLangyStore.getState().interruptedConversationId).toBe("conv-1");

      useLangyStore.getState().beginTurn({ conversationId: "conv-1", turnId: "turn-2" });
      expect(useLangyStore.getState().interruptedConversationId).toBeNull();
    });
  });

  describe("when the stop request fails to go out", () => {
    it("forgets the interruption", () => {
      useLangyStore.setState({
        activeConversationId: "conv-1",
        turnPhase: "active",
        activeTurnId: "turn-1",
      });

      useLangyStore.getState().requestStop();
      useLangyStore.getState().abandonStop();

      expect(useLangyStore.getState().interruptedConversationId).toBeNull();
    });
  });

  describe("when no turn is active", () => {
    it("records nothing", () => {
      useLangyStore.setState({
        activeConversationId: "conv-1",
        turnPhase: "idle",
      });

      useLangyStore.getState().requestStop();

      expect(useLangyStore.getState().interruptedConversationId).toBeNull();
    });
  });
});
