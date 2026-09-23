/**
 * The conversation's mode segment.
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

function turn(traceId: string, timestamp: number): TraceListItem {
  return {
    traceId,
    timestamp,
    name: traceId,
    serviceName: "svc",
    durationMs: 1,
    totalCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    evaluations: [],
    events: NO_TRACE_EVENTS,
    nonBilledCost: 0,
    sizeBytes: 0,
    input: null,
    output: null,
    origin: "application",
  };
}

const turns: TraceListItem[] = [turn("trace-1", 1), turn("trace-2", 2)];

vi.mock("../../../hooks/use-conversation-turns.ts", () => ({
  useConversationTurns: () => ({
    data: { items: turns },
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/use-conversation-annotations.ts", () => ({
  useConversationAnnotations: () => ({
    byTrace: new Map(),
    byAnchor: new Map(),
    all: [],
    hasAny: false,
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/use-trace-drawer-navigation.ts", () => ({
  useTraceDrawerNavigation: () => ({ navigateToTrace: vi.fn() }),
}));

vi.mock("../../../hooks/use-conversation-turn-events.ts", () => ({
  useConversationTurnEvents: (rows: TraceListItem[]) => rows,
}));

vi.mock("../../../../../blocks/markdown/rendered-markdown.tsx", () => ({
  RenderedMarkdown: () => null,
}));

vi.mock("../annotated-turn-row.tsx", () => ({
  AnnotatedTurnRow: ({ parsed }: { parsed: { turn: { traceId: string } } }) => (
    <div data-testid="annotated-turn-row">{parsed.turn.traceId}</div>
  ),
}));

import type { TraceListItem } from "../../../types/trace.ts";
import { NO_TRACE_EVENTS } from "../../../types/trace.ts";
import { ConversationView } from "../conversation-view.tsx";

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
const conversationHeader = () => screen.getByText("Conversation").parentElement!;

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
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Thread",
      "Bubbles",
      "Markdown",
    ]);
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
      fallbackTurns: turns.slice(0, 1),
    });

    expect(conversationHeader()).toHaveTextContent("trace-1");
  });
});
