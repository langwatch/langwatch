// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildTree } from "../tree.ts";
import type { TraceFlameSpan, Viewport } from "../types.ts";
import { useFlameKeyboard } from "../use-flame-keyboard.ts";

const span = (spanId: string, start: number, end: number, parent: string | null) =>
  ({
    spanId,
    parentSpanId: parent,
    name: spanId,
    type: "span",
    startTimeMs: start,
    endTimeMs: end,
    status: "ok",
    model: null,
  }) satisfies TraceFlameSpan;

const tree = buildTree([
  span("root", 0, 100, null),
  span("a", 0, 10, "root"),
  span("b", 20, 30, "root"),
  span("c", 40, 50, "root"),
  span("b1", 21, 22, "b"),
]);

type Setup = { viewport?: Viewport; selected?: string | null; focused?: string | null };

function flame({ viewport = { startMs: 0, endMs: 100 }, selected = null, focused = null }: Setup) {
  const el = document.createElement("div");
  const input = document.createElement("input");
  el.append(input);
  document.body.append(el);
  const calls: string[] = [];
  let current = viewport;
  renderHook(() =>
    useFlameKeyboard({
      containerRef: { current: el },
      tree,
      fullDur: 100,
      selectedSpanId: selected,
      focusedSpanId: focused,
      setFocusedSpanId: (id) => calls.push(`focus:${id}`),
      viewportRef: { current: viewport },
      setViewport: (update) => {
        current = typeof update === "function" ? update(current) : update;
        calls.push(`viewport:${current.startMs.toFixed(2)}-${current.endMs.toFixed(2)}`);
      },
      clampViewport: (v) => v,
      handleResetZoom: () => calls.push("reset"),
      handleSpanDoubleClick: (id) => calls.push(`open:${id}`),
      onClearSpan: () => calls.push("clear"),
      onSelectSpan: (id) => calls.push(`select:${id}`),
    }),
  );
  el.addEventListener("keydown", () => calls.push("later-listener"));
  const press = (
    key: string,
    { shiftKey = false, on = el }: { shiftKey?: boolean; on?: HTMLElement } = {},
  ) => {
    const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    on.dispatchEvent(event);
    return { prevented: event.defaultPrevented, calls: calls.splice(0) };
  };
  return { press, input };
}

describe("flame keyboard navigation", () => {
  it("escape resets a zoomed view first, then clears the selected span", () => {
    expect(flame({ viewport: { startMs: 10, endMs: 60 }, selected: "a" }).press("Escape")).toEqual({
      prevented: true,
      calls: ["reset", "later-listener"],
    });
    expect(flame({ selected: "a" }).press("Escape")).toEqual({
      prevented: true,
      calls: ["clear", "later-listener"],
    });
    expect(flame({}).press("Escape")).toEqual({ prevented: false, calls: ["later-listener"] });
  });

  it("0 and Home reset the zoom; Enter opens and space selects the focused span", () => {
    expect(flame({}).press("0").calls).toEqual(["reset", "later-listener"]);
    expect(flame({}).press("Home").calls).toEqual(["reset", "later-listener"]);
    expect(flame({ focused: "b" }).press("Enter")).toEqual({
      prevented: true,
      calls: ["open:b", "later-listener"],
    });
    expect(flame({ focused: "b" }).press(" ").calls).toEqual(["select:b", "later-listener"]);
    expect(flame({}).press("Enter")).toEqual({ prevented: false, calls: ["later-listener"] });
    expect(flame({}).press(" ")).toEqual({ prevented: false, calls: ["later-listener"] });
  });

  it("shift-arrows pan the view and hold the key from later listeners", () => {
    expect(flame({ focused: "b" }).press("ArrowRight", { shiftKey: true })).toEqual({
      prevented: true,
      calls: ["viewport:20.00-120.00"],
    });
    expect(flame({}).press("ArrowLeft", { shiftKey: true }).calls).toEqual([
      "viewport:-20.00-80.00",
    ]);
  });

  it("arrows walk siblings, parent and first child of the focused span", () => {
    expect(flame({ focused: "b" }).press("ArrowLeft")).toEqual({
      prevented: true,
      calls: ["focus:a"],
    });
    expect(flame({ focused: "b" }).press("ArrowRight").calls).toEqual(["focus:c"]);
    expect(flame({ focused: "c" }).press("ArrowRight")).toEqual({
      prevented: false,
      calls: ["later-listener"],
    });
    expect(flame({ focused: "root" }).press("ArrowLeft").calls).toEqual(["later-listener"]);
    expect(flame({}).press("ArrowLeft")).toEqual({ prevented: false, calls: ["later-listener"] });
    expect(flame({ focused: "b" }).press("ArrowUp")).toEqual({
      prevented: true,
      calls: ["focus:root", "later-listener"],
    });
    expect(flame({ focused: "b" }).press("ArrowDown").calls).toEqual([
      "focus:b1",
      "later-listener",
    ]);
    expect(flame({ focused: "b1" }).press("ArrowDown").prevented).toBe(false);
    expect(flame({ focused: "root" }).press("ArrowUp").prevented).toBe(false);
    expect(flame({ focused: "gone" }).press("ArrowUp").prevented).toBe(false);
  });

  it("plus and minus zoom around the centre", () => {
    expect(flame({}).press("+").calls).toEqual(["viewport:15.00-85.00", "later-listener"]);
    expect(flame({}).press("=").calls).toEqual(["viewport:15.00-85.00", "later-listener"]);
    expect(flame({}).press("-").calls).toEqual(["viewport:-21.43-121.43", "later-listener"]);
    expect(flame({}).press("_").prevented).toBe(true);
  });

  it("ignores keys typed into a field and unhandled keys", () => {
    expect(flame({}).press("0", { on: flame({}).input })).toEqual({ prevented: false, calls: [] });
    const { press, input } = flame({ focused: "b" });
    expect(press("Enter", { on: input })).toEqual({ prevented: false, calls: ["later-listener"] });
    expect(press("q")).toEqual({ prevented: false, calls: ["later-listener"] });
  });
});
