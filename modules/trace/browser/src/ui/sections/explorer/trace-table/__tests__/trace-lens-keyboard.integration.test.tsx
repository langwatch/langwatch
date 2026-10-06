/**
 * @vitest-environment jsdom
 *
 * How a row click and the keyboard drive the trace drawer and the inline peek.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_TRACE_EVENTS, type TraceListItem } from "../../types/trace.ts";
import { useTraceLensKeyboard } from "../use-trace-lens-keyboard.ts";

const host = vi.hoisted(() => ({
  currentDrawer: null as string | null,
  params: {} as { traceId?: string },
  closeDrawer: vi.fn(),
  openTrace: vi.fn(),
}));

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ closeDrawer: host.closeDrawer, currentDrawer: host.currentDrawer }),
  useDrawerParams: () => host.params,
}));

vi.mock("../../hooks/use-open-trace-drawer.ts", () => ({
  useOpenTraceDrawer: () => host.openTrace,
}));

function trace(traceId: string): TraceListItem {
  return {
    traceId,
    timestamp: 0,
    name: traceId,
    serviceName: "svc",
    durationMs: 1,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    evaluations: [],
    events: NO_TRACE_EVENTS,
    sizeBytes: 0,
    input: null,
    output: null,
    origin: "application",
  };
}

const TRACES = [trace("abc123"), trace("def456"), trace("ghi789")];

type Keyboard = ReturnType<typeof useTraceLensKeyboard>;

/** The table body as the lens renders it: the hook's key handler on a focusable box. */
function renderBody() {
  const latest: { current: Keyboard | null } = { current: null };
  const Body = () => {
    const keyboard = useTraceLensKeyboard({ traces: TRACES });
    latest.current = keyboard;
    return <div role="grid" tabIndex={0} data-testid="body" onKeyDown={keyboard.handleKeyDown} />;
  };
  renderWithDesignSystem(<Body />);
  const state = (): Keyboard => {
    if (!latest.current) throw new Error("the table body did not render");
    return latest.current;
  };
  const press = (name: string) => fireEvent.keyDown(screen.getByTestId("body"), { key: name });
  return { state, press };
}

beforeEach(() => {
  host.currentDrawer = null;
  host.params = {};
  host.closeDrawer.mockReset();
  host.openTrace.mockReset();
});

afterEach(cleanup);

describe("clicking a trace row", () => {
  describe("given no drawer is open", () => {
    /** @scenario Clicking a row opens the trace drawer */
    it("opens the drawer on that trace", () => {
      const { state } = renderBody();

      act(() => state().toggleTrace(TRACES[0]!));

      expect(host.openTrace).toHaveBeenCalledWith(TRACES[0]);
      expect(host.closeDrawer).not.toHaveBeenCalled();
    });
  });

  describe("given the drawer is open for trace abc123", () => {
    beforeEach(() => {
      host.currentDrawer = "traceV2Details";
      host.params = { traceId: "abc123" };
    });

    /** @scenario Clicking the same trace again closes the drawer (toggle) */
    it("closes the drawer when the same row is clicked", () => {
      const { state } = renderBody();

      expect(state().selectedTraceId).toBe("abc123");
      act(() => state().toggleTrace(TRACES[0]!));

      expect(host.closeDrawer).toHaveBeenCalledTimes(1);
      expect(host.openTrace).not.toHaveBeenCalled();
    });

    /** @scenario Clicking a different trace updates the drawer */
    it("opens the drawer on the other trace when another row is clicked", () => {
      const { state } = renderBody();

      act(() => state().toggleTrace(TRACES[1]!));

      expect(host.openTrace).toHaveBeenCalledWith(TRACES[1]);
      expect(host.closeDrawer).not.toHaveBeenCalled();
    });
  });
});

describe("the keyboard on the table body", () => {
  describe("when the reader presses the arrow keys", () => {
    /** @scenario Keyboard navigation with arrow keys */
    it("moves the focused row by one and clamps at both ends", () => {
      const { state, press } = renderBody();

      press("ArrowDown");
      expect(state().focusedIndex).toBe(0);
      press("ArrowDown");
      press("ArrowDown");
      press("ArrowDown");
      expect(state().focusedIndex).toBe(TRACES.length - 1);

      press("ArrowUp");
      expect(state().focusedIndex).toBe(TRACES.length - 2);
      press("ArrowUp");
      press("ArrowUp");
      press("ArrowUp");
      expect(state().focusedIndex).toBe(0);
    });
  });

  describe("given a row is focused", () => {
    /** @scenario Enter key toggles the drawer for the focused row */
    it("opens the drawer on the focused row when Enter is pressed", () => {
      const { press } = renderBody();
      press("ArrowDown");
      press("ArrowDown");

      press("Enter");

      expect(host.openTrace).toHaveBeenCalledWith(TRACES[1]);
    });

    /** @scenario Enter key toggles the drawer for the focused row */
    it("closes the drawer when Enter is pressed on the row it is already open for", () => {
      host.currentDrawer = "traceV2Details";
      host.params = { traceId: "abc123" };
      const { press } = renderBody();
      press("ArrowDown");

      press("Enter");

      expect(host.closeDrawer).toHaveBeenCalledTimes(1);
      expect(host.openTrace).not.toHaveBeenCalled();
    });

    /** @scenario "p" toggles the inline peek for the focused row */
    it("expands the focused row on p and collapses it on a second p", () => {
      const { state, press } = renderBody();
      press("ArrowDown");

      press("p");
      expect(state().expandedTraceId).toBe("abc123");
      press("p");
      expect(state().expandedTraceId).toBeNull();
    });
  });

  describe("given the drawer is open", () => {
    /** @scenario Escape closes the drawer */
    it("closes the drawer when Escape is pressed", () => {
      host.currentDrawer = "traceV2Details";
      host.params = { traceId: "abc123" };
      const { press } = renderBody();

      press("Escape");

      expect(host.closeDrawer).toHaveBeenCalledTimes(1);
    });
  });
});
