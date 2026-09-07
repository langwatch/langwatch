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
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => {
  const thread = [
    { traceId: "trace-1", timestamp: 1, input: null, output: null },
    { traceId: "trace-2", timestamp: 2, input: null, output: null },
    { traceId: "trace-3", timestamp: 3, input: null, output: null },
  ];
  return { thread, turns: thread };
});

vi.mock("../../../../hooks/useConversationTurns", () => ({
  useConversationTurns: () => ({
    data: { items: mocks.turns },
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

vi.mock("../../markdownView", () => ({ RenderedMarkdown: () => null }));

/**
 * The row paints the tint around its own conversation column, which is covered
 * where that layout lives; here it reports what the conversation told it about
 * the turn under review.
 */
vi.mock("../AnnotatedTurnRow", () => ({
  AnnotatedTurnRow: ({
    parsed,
    showSessionCheckbox,
    isFocused,
    isBlinking,
  }: {
    parsed: { turn: { traceId: string } };
    showSessionCheckbox?: boolean;
    isFocused?: boolean;
    isBlinking?: boolean;
  }) => (
    <div
      data-testid="annotated-turn-row"
      data-session-checkbox={String(!!showSessionCheckbox)}
      data-focused-turn={String(!!isFocused)}
      data-blinking={String(!!isBlinking)}
    >
      {parsed.turn.traceId}
    </div>
  ),
}));

import type { TraceListItem } from "../../../../types/trace";
import { ConversationView } from "../ConversationView";
import { FOCUS_SCROLL_REST_MS } from "../FocusedTurn";

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

/** The turn under review, while it is blinking. */
const blinkingTurns = () =>
  document.querySelectorAll('[data-focused-turn="true"][data-blinking="true"]');

const scrollTo = vi.fn();

/** Fake clocks the delayed carry, the blink, and the settle loop all run on. */
function useFakeClocks() {
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
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

/** Waits out the beat the conversation rests for before it carries the reader. */
const restIsOver = () => advance(FOCUS_SCROLL_REST_MS + 50);

beforeEach(() => {
  scrollTo.mockClear();
  mocks.turns = mocks.thread;
  // jsdom has no scrolling of its own, so the container reports the call.
  Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];
});

afterEach(cleanup);

describe("given a queue item opened on a thread of several turns", () => {
  beforeEach(useFakeClocks);
  afterEach(() => vi.useRealTimers());

  /** @scenario "Opening a queue item scrolls its turn into view" */
  it("scrolls the conversation to the item's own turn, and blinks it", () => {
    renderView({ focusTraceId: "trace-2" });

    restIsOver();

    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
    expect(blinkingTurns()).toHaveLength(1);
    expect(blinkingTurns()[0]).toHaveTextContent("trace-2");
  });

  /** @scenario "The scroll waits a beat so the conversation is seen first" */
  it("rests where it loaded, then carries the reader and blinks together", () => {
    renderView({ focusTraceId: "trace-2" });

    advance(FOCUS_SCROLL_REST_MS - 100);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(blinkingTurns()).toHaveLength(0);

    advance(200);

    expect(scrollTo).toHaveBeenCalled();
    expect(blinkingTurns()).toHaveLength(1);
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
    useFakeClocks();
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

    restIsOver();

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 100 }),
    );

    mockOffsetTop = 420;
    advance(120);

    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 420 }),
    );

    advance(3000);
    const settledCalls = scrollTo.mock.calls.length;
    mockOffsetTop = 900;
    advance(300);

    expect(scrollTo.mock.calls.length).toBe(settledCalls);
  });
});

describe("given a queue item whose thread is that one trace", () => {
  /** @scenario "The only turn of a conversation is not tinted" */
  it("leaves the turn plain, having nothing to tell it apart from", () => {
    mocks.turns = [mocks.thread[0]!];

    renderView({ focusTraceId: "trace-1" });

    expect(screen.getAllByTestId("annotated-turn-row")).toHaveLength(1);
    expect(focusedFrames()).toHaveLength(0);
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
