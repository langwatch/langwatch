/**
 * @vitest-environment jsdom
 *
 * The conversation's mode segment. Annotations are no longer one of the modes:
 * they read beside the turn they are about instead of in a rollup the reviewer
 * has to leave the conversation to open. See specs/traces-v2/annotations.feature
 * and specs/traces-v2/annotation-rail.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const turns = [
  { traceId: "trace-1", timestamp: 1, input: null, output: null },
  { traceId: "trace-2", timestamp: 2, input: null, output: null },
];

vi.mock("../../../../hooks/useConversationTurns", () => ({
  useConversationTurns: () => ({
    data: { items: turns },
    isLoading: false,
  }),
}));

vi.mock("../../../../hooks/useConversationAnnotations", () => ({
  useConversationAnnotations: () => ({
    byTrace: new Map(),
    byAnchor: new Map(),
    all: [],
    hasAny: false,
    isLoading: false,
  }),
}));

vi.mock("../../../../hooks/useTraceDrawerNavigation", () => ({
  useTraceDrawerNavigation: () => ({ navigateToTrace: vi.fn() }),
}));

vi.mock("../../../../hooks/useConversationTurnEvents", () => ({
  useConversationTurnEvents: (rows: TraceListItem[]) => rows,
}));

vi.mock("../../markdownView", () => ({
  RenderedMarkdown: () => null,
}));

vi.mock("../AnnotatedTurnRow", () => ({
  AnnotatedTurnRow: ({ parsed }: { parsed: { turn: { traceId: string } } }) => (
    <div data-testid="annotated-turn-row">{parsed.turn.traceId}</div>
  ),
}));

import type { TraceListItem } from "../../../../types/trace";
import { ConversationView } from "../ConversationView";

function renderView({
  conversationId = "thread-1" as string | null,
  currentTraceId = "trace-1",
  fallbackTurns,
}: {
  conversationId?: string | null;
  currentTraceId?: string;
  fallbackTurns?: TraceListItem[];
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ConversationView
        conversationId={conversationId}
        currentTraceId={currentTraceId}
        fallbackTurns={fallbackTurns}
      />
    </ChakraProvider>,
  );
}

/** The header strip, found by the label that always sits at its left. */
const conversationHeader = () =>
  screen.getByText("Conversation").parentElement!;

afterEach(cleanup);

describe("given the trace drawer is open on a conversation", () => {
  /** @scenario "The conversation offers no separate annotations mode" */
  /** @scenario "The conversation view uses the same format selector" */
  it("offers thread, bubbles, and markdown only", async () => {
    const user = userEvent.setup();
    renderView();

    const trigger = screen.getByRole("button", {
      name: "Conversation view format",
    });
    expect(trigger).toHaveTextContent("Thread");

    await user.click(trigger);
    await screen.findByRole("menuitem", { name: "Thread" });
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Thread", "Bubbles", "Markdown"]);
  });

  it("names the conversation it is showing", () => {
    renderView();

    expect(conversationHeader()).toHaveTextContent("thread-1");
  });
});

describe("given a trace that belongs to no conversation", () => {
  it("names the header by the trace instead of leaving it blank", () => {
    renderView({
      conversationId: null,
      currentTraceId: "trace-1",
      fallbackTurns: [turns[0] as unknown as TraceListItem],
    });

    expect(conversationHeader()).toHaveTextContent("trace-1");
  });
});
