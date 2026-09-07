import { useEffect } from "react";
import type { BuiltTree, Viewport } from "./types.ts";

interface FlameKeyboardCtx {
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
}

function handleEscapeKey(e: KeyboardEvent, ctx: FlameKeyboardCtx): void {
  const isStillZoomed =
    ctx.viewportRef.current.endMs - ctx.viewportRef.current.startMs < ctx.fullDur * 0.999;
  if (isStillZoomed) {
    e.preventDefault();
    ctx.handleResetZoom();
  } else if (ctx.selectedSpanId) {
    e.preventDefault();
    ctx.onClearSpan();
  }
}

function handleArrowLeftRightKey(e: KeyboardEvent, ctx: FlameKeyboardCtx): void {
  // Only intercept Arrow keys when the user has actually engaged with the flame
  // — either holding shift to pan the viewport, or navigating between sibling
  // spans after focusing one.
  const direction = e.key === "ArrowLeft" ? -1 : 1;
  if (e.shiftKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    ctx.setViewport((v) => {
      const d = v.endMs - v.startMs;
      const pan = d * 0.2 * direction;
      return ctx.clampViewport({
        startMs: v.startMs + pan,
        endMs: v.endMs + pan,
      });
    });
    return;
  }
  if (!ctx.focusedSpanId) return;
  const node = ctx.tree.byId.get(ctx.focusedSpanId);
  if (!node) return;
  const siblings = node.parent ? node.parent.children : ctx.tree.roots;
  const idx = siblings.findIndex((n) => n.span.spanId === ctx.focusedSpanId);
  const next = siblings[idx + direction];
  if (next) {
    e.preventDefault();
    e.stopImmediatePropagation();
    ctx.setFocusedSpanId(next.span.spanId);
  }
}

function handleArrowUpDownKey(e: KeyboardEvent, ctx: FlameKeyboardCtx): void {
  if (!ctx.focusedSpanId) return;
  const node = ctx.tree.byId.get(ctx.focusedSpanId);
  if (!node) return;
  if (e.key === "ArrowUp" && node.parent) {
    e.preventDefault();
    ctx.setFocusedSpanId(node.parent.span.spanId);
  } else if (e.key === "ArrowDown" && node.children.length > 0) {
    e.preventDefault();
    ctx.setFocusedSpanId(node.children[0]!.span.spanId);
  }
}

function handleZoomKey(e: KeyboardEvent, ctx: FlameKeyboardCtx, factor: number): void {
  e.preventDefault();
  ctx.setViewport((v) => {
    const center = (v.startMs + v.endMs) / 2;
    const newDur = (v.endMs - v.startMs) * factor;
    return ctx.clampViewport({
      startMs: center - newDur / 2,
      endMs: center + newDur / 2,
    });
  });
}

function dispatchFlameKey(e: KeyboardEvent, ctx: FlameKeyboardCtx): void {
  switch (e.key) {
    case "Escape":
      return handleEscapeKey(e, ctx);
    case "0":
    case "Home":
      e.preventDefault();
      return ctx.handleResetZoom();
    case "Enter":
      if (ctx.focusedSpanId) {
        e.preventDefault();
        ctx.handleSpanDoubleClick(ctx.focusedSpanId);
      }
      return;
    case " ":
      if (ctx.focusedSpanId) {
        e.preventDefault();
        ctx.onSelectSpan(ctx.focusedSpanId);
      }
      return;
    case "ArrowLeft":
    case "ArrowRight":
      return handleArrowLeftRightKey(e, ctx);
    case "ArrowUp":
    case "ArrowDown":
      return handleArrowUpDownKey(e, ctx);
    case "+":
    case "=":
      return handleZoomKey(e, ctx, 0.7);
    case "-":
    case "_":
      return handleZoomKey(e, ctx, 1 / 0.7);
  }
}

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
} & FlameKeyboardCtx): void {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ctx: FlameKeyboardCtx = {
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
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.target instanceof HTMLElement)) return;
      const target = e.target;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;
      if (!el.contains(target) && target !== el) return;

      dispatchFlameKey(e, ctx);
    };
    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [
    containerRef,
    fullDur,
    selectedSpanId,
    focusedSpanId,
    tree.byId,
    tree.roots,
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
