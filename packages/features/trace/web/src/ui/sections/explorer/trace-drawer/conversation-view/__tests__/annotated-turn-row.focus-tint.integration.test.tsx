/**
 * @vitest-environment jsdom
 *
 * The tint on the turn under review: what it wraps, what it leaves out, and why
 * the room it takes around the turn costs the layout nothing. See
 * packages/features/annotation/specs/annotation-queue-workflow.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../chat-turn-row", () => ({
  ChatTurnRow: ({ turn }: { turn: { traceId: string } }) => (
    <div data-testid="chat-turn-row">{turn.traceId}</div>
  ),
}));

vi.mock("../turn-annotation-rail", () => ({
  TurnAnnotationRail: () => <div data-testid="turn-annotation-rail" />,
}));

import { NO_TRACE_EVENTS, type TraceListItem } from "../../../types/trace";
import { AnnotatedTurnRow } from "../annotated-turn-row";
import type { ParsedTurn, TurnLayout } from "../types";
import {
  RAIL_WIDTH_SLIM_PX,
  RAIL_WIDTH_WIDE_PX,
  type RailLayout,
} from "../use-rail-layout";

const TRACE_ID = "trace-1";
const SIDE_LAYOUT: RailLayout = {
  mode: "side",
  railWidth: RAIL_WIDTH_WIDE_PX,
};
const STACKED_LAYOUT: RailLayout = {
  mode: "stacked",
  railWidth: RAIL_WIDTH_SLIM_PX,
};

function parsedTurn(): ParsedTurn {
  return {
    turn: {
      traceId: TRACE_ID,
      timestamp: 1,
      name: "turn",
      serviceName: "svc",
      durationMs: 10,
      totalCost: 0,
      nonBilledCost: 0,
      totalTokens: 0,
      models: [],
      labels: [],
      status: "ok",
      spanCount: 1,
      sizeBytes: 0,
      input: "a question",
      output: "the original answer",
      origin: "application",
      evaluations: [],
      events: NO_TRACE_EVENTS,
    } as TraceListItem,
    userText: "a question",
    assistantText: "the original answer",
    assistantReasoning: "",
    userMedia: [],
    assistantMedia: [],
    gapSecs: 0,
    showGap: false,
  };
}

function renderRow({
  isFocused = false,
  isBlinking = false,
  isRailActive = true,
  railLayout = SIDE_LAYOUT,
  layout = "thread" as TurnLayout,
} = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AnnotatedTurnRow
        parsed={parsedTurn()}
        index={1}
        layout={layout}
        isCurrent={false}
        isFocused={isFocused}
        isBlinking={isBlinking}
        onSelectTurn={vi.fn()}
        isRailActive={isRailActive}
        railLayout={railLayout}
      />
    </ChakraProvider>,
  );
}

const tint = () => document.querySelector('[data-focused-turn="true"]') as HTMLElement;

afterEach(cleanup);

describe("given the turn under review carries annotations in the rail beside it", () => {
  /** @scenario "The tint hugs the turn and leaves the rail out" */
  it("wraps the turn with breathing room of its own and leaves the rail out", () => {
    renderRow({ isFocused: true });

    expect(tint()).toContainElement(screen.getByTestId("chat-turn-row"));
    expect(tint()).not.toContainElement(screen.getByTestId("turn-annotation-rail"));

    // Every millimetre of room the tint takes around the turn is given back as
    // margin, so the turn and its neighbours sit exactly where they would
    // without it.
    const style = getComputedStyle(tint());
    // Painted as a wash of the theme's blue rather than left to the surface
    // underneath, which is the whole point of the frame.
    expect(style.background).toContain("blue");

    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      const room = Number.parseFloat(style[`padding${side}`]);
      expect(room).toBeGreaterThan(0);
      expect(Number.parseFloat(style[`margin${side}`])).toBe(-room);
    }
  });

  it("leaves the rail out when it is stacked under the turn as well", () => {
    renderRow({ isFocused: true, railLayout: STACKED_LAYOUT });

    expect(tint()).toContainElement(screen.getByTestId("chat-turn-row"));
    expect(tint()).not.toContainElement(screen.getByTestId("turn-annotation-rail"));
  });
});

describe("given a turn nobody was sent to", () => {
  it("tints nothing", () => {
    renderRow({ isFocused: false });

    expect(tint()).toBeNull();
  });
});
