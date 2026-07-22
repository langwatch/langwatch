/**
 * @vitest-environment jsdom
 *
 * The composer's availability is a DERIVATION of the recorded turn (ADR-059
 * §4): recorded events fold through the shared `foldLangyConversationTurn`
 * reducer into the store's local turn projection, the projection composes with
 * the turn-phase machine, and the composer reads that one value. Nothing here
 * pokes `turnPhase` directly — the only inputs are durable events, exactly as
 * the freshness coordinator delivers them from the tail read.
 *
 * Spec: specs/langy/langy-event-sourced-frontend.feature
 *
 * Boundary mocks: the shared ModelSelector (a project-provider query the rail
 * would otherwise pull) and the typewriter placeholder hook. The store, the
 * fold, and the composer are all real.
 */
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLangyStore } from "../stores/langyStore";

vi.mock("~/components/ModelSelector", () => ({
  ModelSelector: ({ model }: { model: string }) => (
    <div data-testid="model-selector">{model}</div>
  ),
  useModelSelectionOptions: (options: string[], model: string) => ({
    selectOptions: options.map((value) => ({
      value,
      label: value,
      isCustom: false,
    })),
    modelOption: options.includes(model)
      ? { value: model, label: model, isCustom: false }
      : undefined,
  }),
}));
vi.mock("~/features/traces-v2/components/ai/useTypewriterPlaceholder", () => ({
  useTypewriterPlaceholder: () => "Ask Langy…",
}));

import { Composer } from "../components/Composer";

const CONVERSATION_ID = "conv-recorded";
const TURN_ID = "turn-recorded";

/** The recorded step that opens a turn — what makes the record say "running". */
const turnAccepted = (o: { id: string; createdAt: number }) => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
  data: { conversationId: CONVERSATION_ID, turnId: TURN_ID },
});

/** The recorded terminal — the answer, and the end of the turn. */
const agentResponded = (o: { id: string; createdAt: number }) => ({
  id: o.id,
  createdAt: o.createdAt,
  occurredAt: o.createdAt,
  type: LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
  data: {
    conversationId: CONVERSATION_ID,
    turnId: TURN_ID,
    messageId: "message-1",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: "p95 is up on the retriever." }],
    outcome: "completed" as const,
  },
});

function renderComposer(onSend: (text: string) => void) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Composer
        model="openai/gpt-5-mini"
        modelOptions={["openai/gpt-5-mini"]}
        onModelChange={() => undefined}
        onSend={onSend}
        onStop={() => undefined}
        disabled={false}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  // A fresh page load: `scopeAnnounced` is never persisted, and without
  // clearing it a repeated same-scope reset is a deliberate heartbeat no-op
  // that would leak the previous test's projection.
  useLangyStore.setState({ scopeAnnounced: false });
  useLangyStore.getState().resetForProject("project-test");
});

afterEach(() => {
  cleanup();
  useLangyStore.setState({ scopeAnnounced: false });
  useLangyStore.getState().resetForProject("project-test");
});

describe("given the composer follows the recorded turn", () => {
  describe("when the record carries a turn in progress", () => {
    /** @scenario Sending stays unavailable exactly while a turn is recorded in flight */
    it("holds sending shut until the recorded terminal lands, then opens it", async () => {
      const onSend = vi.fn();
      // The record says a turn is running — folded from the durable tail, the
      // way the freshness coordinator applies it.
      useLangyStore
        .getState()
        .applyTurnEvents([turnAccepted({ id: "event-1", createdAt: 1_000 })]);
      useLangyStore.getState().setDraft("what changed in p95?");

      const { container } = renderComposer(onSend);

      expect(screen.getByLabelText("Stop")).toBeTruthy();
      expect(screen.queryByLabelText("Send")).toBeNull();

      // The one gesture that could still slip a send through mid-turn. The
      // message field has no accessible name of its own — it is the composer's
      // only textarea.
      const field = container.querySelector("textarea")!;
      await userEvent.type(field, "{Enter}");
      expect(onSend).not.toHaveBeenCalled();

      // The turn reaches its recorded terminal — nothing else changes.
      useLangyStore
        .getState()
        .applyTurnEvents([agentResponded({ id: "event-2", createdAt: 2_000 })]);

      expect(await screen.findByLabelText("Send")).toBeTruthy();
      expect(screen.queryByLabelText("Stop")).toBeNull();

      await userEvent.type(field, "{Enter}");
      expect(onSend).toHaveBeenCalledWith("what changed in p95?");
    });
  });
});
