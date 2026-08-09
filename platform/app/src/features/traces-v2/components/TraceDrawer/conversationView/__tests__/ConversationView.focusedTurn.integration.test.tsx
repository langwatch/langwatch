/**
 * @vitest-environment jsdom
 *
 * The turn under review: the conversation brings it onto the screen, blinks it
 * once, and keeps it tinted for as long as it is the one being reviewed, so it
 * is still obvious after the reader has scrolled around themselves. Also the
 * session ticks, which only the queue asks for. See
 * specs/annotations/annotation-queue-workflow.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const turns = [
  { traceId: "trace-1", timestamp: 1, input: null, output: null },
  { traceId: "trace-2", timestamp: 2, input: null, output: null },
  { traceId: "trace-3", timestamp: 3, input: null, output: null },
];

vi.mock("../../../../hooks/useConversationTurns", () => ({
  useConversationTurns: () => ({ data: { items: turns }, isLoading: false }),
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

vi.mock("../../markdownView", () => ({ RenderedMarkdown: () => null }));

vi.mock("../AnnotatedTurnRow", () => ({
  AnnotatedTurnRow: ({
    parsed,
    showSessionCheckbox,
  }: {
    parsed: { turn: { traceId: string } };
    showSessionCheckbox?: boolean;
  }) => (
    <div
      data-testid="annotated-turn-row"
      data-session-checkbox={String(!!showSessionCheckbox)}
    >
      {parsed.turn.traceId}
    </div>
  ),
}));

import type { TraceListItem } from "../../../../types/trace";
import { ConversationView } from "../ConversationView";

function renderView({
  focusTraceId,
  showSessionCheckboxes = false,
}: {
  focusTraceId?: string;
  showSessionCheckboxes?: boolean;
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ConversationView
        conversationId="thread-1"
        currentTraceId="trace-1"
        focusTraceId={focusTraceId}
        showSessionCheckboxes={showSessionCheckboxes}
      />
    </ChakraProvider>,
  );
}

/** The frame drawn around the turn under review, if there is one. */
const focusedFrames = () =>
  document.querySelectorAll('[data-focused-turn="true"]');

const scrollTo = vi.fn();

beforeEach(() => {
  scrollTo.mockClear();
  // jsdom has no scrolling of its own, so the container reports the call.
  Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];
});

afterEach(cleanup);

describe("given a queue item opened on a thread of several turns", () => {
  /** @scenario "Opening a queue item scrolls its turn into view" */
  it("scrolls the conversation to the item's own turn", () => {
    renderView({ focusTraceId: "trace-2" });

    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });

  /** @scenario "The turn under review keeps a distinct background" */
  it("tints that turn and no other", () => {
    renderView({ focusTraceId: "trace-2" });

    const frames = focusedFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveTextContent("trace-2");
  });

  /** @scenario "Moving to the next item moves the focus" */
  it("moves the tint when the reader is moved to the next item", () => {
    const view = renderView({ focusTraceId: "trace-2" });

    view.rerender(
      <ChakraProvider value={defaultSystem}>
        <ConversationView
          conversationId="thread-1"
          currentTraceId="trace-1"
          focusTraceId="trace-3"
        />
      </ChakraProvider>,
    );

    const frames = focusedFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveTextContent("trace-3");
  });
});

describe("given the thread is still laying out when the reader arrives", () => {
  const originalOffsetTop = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetTop",
  );
  let mockOffsetTop = 0;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
        "Date",
      ],
    });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get: () => mockOffsetTop,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    if (originalOffsetTop) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetTop",
        originalOffsetTop,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "offsetTop");
    }
  });

  // The turns above the one under review (their annotation cards especially)
  // measure in after the first paint and push it further down, so a single
  // scroll lands short of where the turn ends up.
  /** @scenario "Opening a queue item scrolls its turn into view" */
  it("keeps centering until the turn stops moving, then lets go", () => {
    mockOffsetTop = 100;
    renderView({ focusTraceId: "trace-2" });

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 100 }),
    );

    mockOffsetTop = 420;
    vi.advanceTimersByTime(120);

    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 420 }),
    );

    vi.advanceTimersByTime(3000);
    const settledCalls = scrollTo.mock.calls.length;
    mockOffsetTop = 900;
    vi.advanceTimersByTime(300);

    expect(scrollTo.mock.calls.length).toBe(settledCalls);
  });
});

describe("given a conversation read with no turn under review", () => {
  it("tints nothing and scrolls nowhere", () => {
    renderView();

    expect(focusedFrames()).toHaveLength(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("given a conversation read while a queue is being walked", () => {
  /** @scenario "A turn is counted in or out by hand" */
  it("offers every turn a session tick", () => {
    renderView({ showSessionCheckboxes: true });

    for (const row of screen.getAllByTestId("annotated-turn-row")) {
      expect(row).toHaveAttribute("data-session-checkbox", "true");
    }
  });
});

describe("given a conversation read in the trace drawer", () => {
  it("offers no session ticks", () => {
    renderView();

    for (const row of screen.getAllByTestId("annotated-turn-row")) {
      expect(row).toHaveAttribute("data-session-checkbox", "false");
    }
  });
});
