/**
 * A long conversation renders its turns through the virtualizer.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** Past VIRTUALIZE_AT, so the view takes its virtualized path. */
const turns: TraceListItem[] = Array.from({ length: 15 }, (_, i) => turn(`trace-${i + 1}`, i + 1));

vi.mock("../../../../../../features/conversation/behavior/use-conversation-turns.ts", () => ({
  useConversationTurns: () => ({
    data: { items: turns },
    isLoading: false,
  }),
}));

vi.mock("../../../../../../features/conversation/behavior/use-conversation-annotations.ts", () => ({
  useConversationAnnotations: () => ({
    byTrace: new Map(),
    byAnchor: new Map(),
    all: [],
    hasAny: false,
    isLoading: false,
  }),
}));

vi.mock("../../../../../../features/trace-drawer/behavior/use-trace-drawer-navigation.ts", () => ({
  useTraceDrawerNavigation: () => ({ navigateToTrace: vi.fn() }),
}));

vi.mock("../../../../../../features/conversation/behavior/use-conversation-turn-events.ts", () => ({
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

import type { TraceListItem } from "../../../../../../behavior/explorer/types/trace.ts";
import { NO_TRACE_EVENTS } from "../../../../../../behavior/explorer/types/trace.ts";
import { ConversationView } from "../conversation-view.tsx";

/** jsdom lays nothing out; the virtualizer renders rows only for a viewport with a size. */
beforeEach(() => {
  for (const name of ["offsetHeight", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: 800 });
  }
  for (const name of ["offsetWidth", "clientWidth"]) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: 900 });
  }
});

afterEach(cleanup);

describe("given the trace drawer is open on a long conversation", () => {
  /** @scenario "A long conversation shows its turns once the view has measured itself" */
  it("renders the turns that fit the viewport rather than an empty list", () => {
    renderWithDesignSystem(<ConversationView conversationId="thread-1" currentTraceId="trace-1" />);

    expect(screen.getAllByTestId("annotated-turn-row").length).toBeGreaterThan(0);
  });
});
