import { useEffect } from "react";

import type { BuiltTree, FlameNode, Viewport } from "./types.ts";

/**
 * Keyboard navigation for the flame view.
 */
export function useFlameKeyboard({
  containerRef,
  tree,
  fullDur,
  selectedSpanId,
  focusedSpanId,
  setFocusedSpanId,
  viewportRef,
  setViewport,
  clampViewport,
  handleResetZoom,
  handleSpanDoubleClick,
  onClearSpan,
  onSelectSpan,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  tree: BuiltTree;
  fullDur: number;
  selectedSpanId: string | null;
  focusedSpanId: string | null;
  setFocusedSpanId: (id: string) => void;
  viewportRef: React.RefObject<Viewport>;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  clampViewport: (v: Viewport) => Viewport;
  handleResetZoom: () => void;
  handleSpanDoubleClick: (spanId: string) => void;
  onClearSpan: () => void;
  onSelectSpan: (spanId: string) => void;
}): void {
  const { byId, roots } = tree;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFlameKeyTarget(el, e.target)) return;
      const viewport = viewportRef.current;
      const action = readFlameKey({
        event: e,
        tree: { byId, roots },
        focusedSpanId,
        selectedSpanId,
        zoomed: viewport.endMs - viewport.startMs < fullDur * 0.999,
      });
      if (!action) return;
      e.preventDefault();
      if (action.kind === "pan" || (action.kind === "focus" && action.exclusive)) {
        e.stopImmediatePropagation();
      }
      applyFlameKey(action, {
        setFocusedSpanId,
        setViewport,
        clampViewport,
        handleResetZoom,
        handleSpanDoubleClick,
        onClearSpan,
        onSelectSpan,
      });
    };
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [
    containerRef,
    fullDur,
    selectedSpanId,
    focusedSpanId,
    byId,
    roots,
    handleResetZoom,
    handleSpanDoubleClick,
    onClearSpan,
    onSelectSpan,
    clampViewport,
    setViewport,
    setFocusedSpanId,
    viewportRef,
  ]);
}

type FlameKeyAction =
  | { kind: "resetZoom" }
  | { kind: "clearSpan" }
  | { kind: "open"; spanId: string }
  | { kind: "select"; spanId: string }
  | { kind: "pan"; direction: -1 | 1 }
  | { kind: "focus"; spanId: string; exclusive: boolean }
  | { kind: "zoom"; direction: "in" | "out" };

type FlameKeyState = {
  event: KeyboardEvent;
  tree: Pick<BuiltTree, "byId" | "roots">;
  focusedSpanId: string | null;
  selectedSpanId: string | null;
  zoomed: boolean;
};

type FlameKeyHandlers = {
  setFocusedSpanId: (id: string) => void;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  clampViewport: (v: Viewport) => Viewport;
  handleResetZoom: () => void;
  handleSpanDoubleClick: (spanId: string) => void;
  onClearSpan: () => void;
  onSelectSpan: (spanId: string) => void;
};

/** A key typed into a field, or aimed outside the flame, is not the flame's to handle. */
function isFlameKeyTarget(el: HTMLElement, target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
    return false;
  }
  return el.contains(target) || target === el;
}

function readFlameKey(state: FlameKeyState): FlameKeyAction | null {
  const { event, focusedSpanId } = state;
  switch (event.key) {
    case "Escape":
      return readEscapeKey(state);
    case "0":
    case "Home":
      return { kind: "resetZoom" };
    case "Enter":
      return focusedSpanId ? { kind: "open", spanId: focusedSpanId } : null;
    case " ":
      return focusedSpanId ? { kind: "select", spanId: focusedSpanId } : null;
    case "ArrowLeft":
    case "ArrowRight":
      return readHorizontalArrow(state);
    case "ArrowUp":
    case "ArrowDown":
      return readVerticalArrow(state);
    case "+":
    case "=":
      return { kind: "zoom", direction: "in" };
    case "-":
    case "_":
      return { kind: "zoom", direction: "out" };
    default:
      return null;
  }
}

function readEscapeKey({ zoomed, selectedSpanId }: FlameKeyState): FlameKeyAction | null {
  if (zoomed) return { kind: "resetZoom" };
  return selectedSpanId ? { kind: "clearSpan" } : null;
}

/** Arrows are intercepted only once engaged: shift pans, a focused span walks its siblings. */
function readHorizontalArrow({ event, tree, focusedSpanId }: FlameKeyState): FlameKeyAction | null {
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  if (event.shiftKey) return { kind: "pan", direction };
  const node = focusedSpanId ? tree.byId.get(focusedSpanId) : undefined;
  if (!node) return null;
  const siblings = node.parent ? node.parent.children : tree.roots;
  const idx = siblings.findIndex((n) => n.span.spanId === focusedSpanId);
  const next = siblings[idx + direction];
  return next ? { kind: "focus", spanId: next.span.spanId, exclusive: true } : null;
}

function readVerticalArrow({ event, tree, focusedSpanId }: FlameKeyState): FlameKeyAction | null {
  const node = focusedSpanId ? tree.byId.get(focusedSpanId) : undefined;
  if (!node) return null;
  const target: FlameNode | undefined =
    event.key === "ArrowUp" ? (node.parent ?? undefined) : node.children[0];
  return target ? { kind: "focus", spanId: target.span.spanId, exclusive: false } : null;
}

function applyFlameKey(action: FlameKeyAction, handlers: FlameKeyHandlers): void {
  const { setViewport, clampViewport } = handlers;
  switch (action.kind) {
    case "resetZoom":
      return handlers.handleResetZoom();
    case "clearSpan":
      return handlers.onClearSpan();
    case "open":
      return handlers.handleSpanDoubleClick(action.spanId);
    case "select":
      return handlers.onSelectSpan(action.spanId);
    case "focus":
      return handlers.setFocusedSpanId(action.spanId);
    case "pan":
      return setViewport((v) => clampViewport(panViewport(v, action.direction)));
    case "zoom":
      return setViewport((v) => clampViewport(zoomViewport(v, action.direction)));
  }
}

function panViewport(v: Viewport, direction: -1 | 1): Viewport {
  const pan = (v.endMs - v.startMs) * 0.2 * direction;
  return { startMs: v.startMs + pan, endMs: v.endMs + pan };
}

function zoomViewport(v: Viewport, direction: "in" | "out"): Viewport {
  const center = (v.startMs + v.endMs) / 2;
  const span = v.endMs - v.startMs;
  const newDur = direction === "in" ? span * 0.7 : span / 0.7;
  return { startMs: center - newDur / 2, endMs: center + newDur / 2 };
}
