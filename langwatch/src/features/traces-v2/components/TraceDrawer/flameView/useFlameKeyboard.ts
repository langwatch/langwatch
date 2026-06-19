import { useEffect } from "react";
import type { BuiltTree, Viewport } from "./types";

/**
 * Keyboard navigation for the flame view.
 * Handles:
 *   Escape / 0 / Home — reset zoom or clear selection
 *   Enter            — zoom-fit the focused span
 *   Space            — select the focused span
 *   ArrowLeft/Right  — pan viewport (+ Shift) or move between siblings (focused span)
 *   ArrowUp/Down     — navigate to parent / first child
 *   +/= and -/_      — zoom in / out toward center
 *
 * Uses functional setState so the listener itself remains stable across renders.
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
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (!el.contains(target) && target !== el) return;

      switch (e.key) {
        case "Escape": {
          if (
            viewportRef.current.endMs - viewportRef.current.startMs <
            fullDur * 0.999
          ) {
            e.preventDefault();
            handleResetZoom();
          } else if (selectedSpanId) {
            e.preventDefault();
            onClearSpan();
          }
          break;
        }
        case "0":
        case "Home": {
          e.preventDefault();
          handleResetZoom();
          break;
        }
        case "Enter": {
          if (focusedSpanId) {
            e.preventDefault();
            handleSpanDoubleClick(focusedSpanId);
          }
          break;
        }
        case " ": {
          if (focusedSpanId) {
            e.preventDefault();
            onSelectSpan(focusedSpanId);
          }
          break;
        }
        case "ArrowLeft":
        case "ArrowRight": {
          // Only intercept Arrow keys when the user has actually engaged
          // with the flame — either holding shift to pan the viewport, or
          // navigating between sibling spans after focusing one. Without
          // a focused span and no modifier, the drawer-level handler is
          // the right consumer (prev/next trace in the conversation), and
          // the previous unconditional `preventDefault()` here used to fight
          // it depending on what had document focus.
          const direction = e.key === "ArrowLeft" ? -1 : 1;
          if (e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            setViewport((v) => {
              const d = v.endMs - v.startMs;
              const pan = d * 0.2 * direction;
              return clampViewport({
                startMs: v.startMs + pan,
                endMs: v.endMs + pan,
              });
            });
          } else if (focusedSpanId) {
            const node = tree.byId.get(focusedSpanId);
            if (node) {
              const siblings = node.parent ? node.parent.children : tree.roots;
              const idx = siblings.findIndex(
                (n) => n.span.spanId === focusedSpanId,
              );
              const next = siblings[idx + direction];
              if (next) {
                e.preventDefault();
                e.stopImmediatePropagation();
                setFocusedSpanId(next.span.spanId);
              }
            }
          }
          break;
        }
        case "ArrowUp":
        case "ArrowDown": {
          if (!focusedSpanId) break;
          const node = tree.byId.get(focusedSpanId);
          if (!node) break;
          if (e.key === "ArrowUp" && node.parent) {
            e.preventDefault();
            setFocusedSpanId(node.parent.span.spanId);
          } else if (e.key === "ArrowDown" && node.children.length > 0) {
            e.preventDefault();
            setFocusedSpanId(node.children[0]!.span.spanId);
          }
          break;
        }
        case "+":
        case "=": {
          e.preventDefault();
          setViewport((v) => {
            const center = (v.startMs + v.endMs) / 2;
            const newDur = (v.endMs - v.startMs) * 0.7;
            return clampViewport({
              startMs: center - newDur / 2,
              endMs: center + newDur / 2,
            });
          });
          break;
        }
        case "-":
        case "_": {
          e.preventDefault();
          setViewport((v) => {
            const center = (v.startMs + v.endMs) / 2;
            const newDur = (v.endMs - v.startMs) / 0.7;
            return clampViewport({
              startMs: center - newDur / 2,
              endMs: center + newDur / 2,
            });
          });
          break;
        }
      }
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
