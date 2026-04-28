import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronRight, LuRotateCcw } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { formatDuration, SPAN_TYPE_COLORS } from "../../utils/formatters";

interface FlameViewProps {
  spans: SpanTreeNode[];
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onClearSpan: () => void;
}

const ROW_HEIGHT = 22;
const ROW_GAP = 2;
const MIN_BLOCK_PX = 2;
const DEPTH_FADE_STEP = 0.06;
const DEPTH_FADE_FLOOR = 0.45;
const MINIMAP_WIDTH = 280;
const MINIMAP_HEIGHT = 72;
const MINIMAP_HANDLE_PX = 10;
const ZOOM_ANIMATION_MS = 220;
const DRAG_THRESHOLD_PX = 4;
const MIN_VIEWPORT_MS = 0.05;
const ZOOM_FIT_PADDING = 0.04;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

interface SpanContext {
  duration: number;
  parentName: string | null;
  parentDuration: number | null;
  pctOfParent: number | null;
  pctOfTrace: number | null;
}

function computeSpanContext(node: FlameNode, fullRange: Viewport): SpanContext {
  const dur = node.span.endTimeMs - node.span.startTimeMs;
  const parentDur = node.parent
    ? node.parent.span.endTimeMs - node.parent.span.startTimeMs
    : null;
  const traceDur = fullRange.endMs - fullRange.startMs;
  return {
    duration: dur,
    parentName: node.parent?.span.name ?? null,
    parentDuration: parentDur,
    pctOfParent:
      parentDur !== null && parentDur > 0 ? (dur / parentDur) * 100 : null,
    pctOfTrace: traceDur > 0 ? (dur / traceDur) * 100 : null,
  };
}

function formatPercent(pct: number): string {
  if (pct >= 99.95) return "100%";
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(2)}%`;
}

interface FlameNode {
  span: SpanTreeNode;
  depth: number;
  parent: FlameNode | null;
  children: FlameNode[];
  isOrphaned: boolean;
}

interface Viewport {
  startMs: number;
  endMs: number;
}

interface BuiltTree {
  roots: FlameNode[];
  all: FlameNode[];
  byId: Map<string, FlameNode>;
  maxDepth: number;
}

function buildTree(spans: SpanTreeNode[]): BuiltTree {
  const spanById = new Map<string, SpanTreeNode>();
  for (const s of spans) spanById.set(s.spanId, s);

  const childrenMap = new Map<string | null, SpanTreeNode[]>();
  for (const s of spans) {
    const parentExists = s.parentSpanId ? spanById.has(s.parentSpanId) : false;
    const key = parentExists ? s.parentSpanId : null;
    const list = childrenMap.get(key) ?? [];
    list.push(s);
    childrenMap.set(key, list);
  }

  const all: FlameNode[] = [];
  const byId = new Map<string, FlameNode>();
  let maxDepth = 0;

  function build(
    parentSpanId: string | null,
    parent: FlameNode | null,
    depth: number,
  ): FlameNode[] {
    const children = (childrenMap.get(parentSpanId) ?? [])
      .slice()
      .sort((a, b) => a.startTimeMs - b.startTimeMs);
    return children.map((span) => {
      const node: FlameNode = {
        span,
        depth,
        parent,
        children: [],
        isOrphaned:
          span.parentSpanId !== null && !spanById.has(span.parentSpanId),
      };
      all.push(node);
      byId.set(span.spanId, node);
      if (depth > maxDepth) maxDepth = depth;
      node.children = build(span.spanId, node, depth + 1);
      return node;
    });
  }

  const roots = build(null, null, 0);
  return { roots, all, byId, maxDepth };
}

// 1-2-5 nice-number step for smart tick spacing.
function niceStep(roughStep: number): number {
  if (roughStep <= 0) return 1;
  const exp = Math.floor(Math.log10(roughStep));
  const f = roughStep / Math.pow(10, exp);
  let nice: number;
  if (f < 1.5) nice = 1;
  else if (f < 3.5) nice = 2;
  else if (f < 7.5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}

function generateTicks(
  viewport: Viewport,
  fullStartMs: number,
  approxCount = 6,
): { time: number; label: string }[] {
  const duration = viewport.endMs - viewport.startMs;
  if (duration <= 0) return [];
  const step = niceStep(duration / approxCount);
  const first = Math.ceil(viewport.startMs / step) * step;
  const ticks: { time: number; label: string }[] = [];
  for (let t = first; t <= viewport.endMs + 1e-9; t += step) {
    ticks.push({ time: t, label: formatDuration(t - fullStartMs) });
  }
  return ticks;
}

export function FlameView({
  spans,
  selectedSpanId,
  onSelectSpan,
  onClearSpan,
}: FlameViewProps) {
  const tree = useMemo(() => buildTree(spans), [spans]);

  const fullRange = useMemo<Viewport>(() => {
    if (spans.length === 0) return { startMs: 0, endMs: 0 };
    let start = Infinity;
    let end = -Infinity;
    for (const s of spans) {
      if (s.startTimeMs < start) start = s.startTimeMs;
      if (s.endTimeMs > end) end = s.endTimeMs;
    }
    return { startMs: start, endMs: end };
  }, [spans]);

  const [viewport, setViewport] = useState<Viewport>(fullRange);
  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);
  const [focusedSpanId, setFocusedSpanId] = useState<string | null>(null);
  const [dragSelection, setDragSelection] = useState<Viewport | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const flameAreaRef = useRef<HTMLDivElement>(null);
  const timeAxisRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const isPanningRef = useRef(false);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Reset viewport when underlying spans change.
  useEffect(() => {
    setViewport(fullRange);
  }, [fullRange]);

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const clampViewport = useCallback(
    (v: Viewport): Viewport => {
      const fullDur = fullRange.endMs - fullRange.startMs;
      if (fullDur <= 0) return fullRange;
      const minDur = Math.min(MIN_VIEWPORT_MS, fullDur);
      const dur = Math.max(minDur, Math.min(fullDur, v.endMs - v.startMs));
      let start = v.startMs;
      let end = start + dur;
      if (start < fullRange.startMs) {
        start = fullRange.startMs;
        end = start + dur;
      }
      if (end > fullRange.endMs) {
        end = fullRange.endMs;
        start = end - dur;
      }
      return { startMs: start, endMs: end };
    },
    [fullRange],
  );

  const animateTo = useCallback(
    (target: Viewport) => {
      cancelAnimation();
      const clamped = clampViewport(target);
      const from = viewportRef.current;
      const startTime = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - startTime) / ZOOM_ANIMATION_MS);
        const e = 1 - Math.pow(1 - t, 3);
        setViewport({
          startMs: from.startMs + (clamped.startMs - from.startMs) * e,
          endMs: from.endMs + (clamped.endMs - from.endMs) * e,
        });
        if (t < 1) {
          animationRef.current = requestAnimationFrame(tick);
        } else {
          animationRef.current = null;
        }
      };
      animationRef.current = requestAnimationFrame(tick);
    },
    [cancelAnimation, clampViewport],
  );

  // Selection-follow: when a span is selected externally and falls fully outside
  // the current viewport, animate the viewport to bring it back into view.
  useEffect(() => {
    if (!selectedSpanId) return;
    const node = tree.byId.get(selectedSpanId);
    if (!node) return;
    const v = viewportRef.current;
    const isCompletelyOutside =
      node.span.endTimeMs < v.startMs || node.span.startTimeMs > v.endMs;
    if (!isCompletelyOutside) return;
    const dur = node.span.endTimeMs - node.span.startTimeMs;
    const vpDur = v.endMs - v.startMs;
    if (dur < vpDur * 0.5) {
      // Span is small relative to current zoom — keep zoom level, just center it.
      const center = (node.span.startTimeMs + node.span.endTimeMs) / 2;
      animateTo({
        startMs: center - vpDur / 2,
        endMs: center + vpDur / 2,
      });
    } else {
      const pad = Math.max(dur * ZOOM_FIT_PADDING, 0);
      animateTo({
        startMs: node.span.startTimeMs - pad,
        endMs: node.span.endTimeMs + pad,
      });
    }
  }, [selectedSpanId, tree.byId, animateTo]);

  // Wheel: zoom toward cursor (deltaY) or pan (deltaX / shift).
  useEffect(() => {
    const el = flameAreaRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimation();
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const isPan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const delta = isPan ? e.deltaX || e.deltaY : e.deltaY;
      setViewport((prev) => {
        const dur = prev.endMs - prev.startMs;
        if (isPan) {
          const dt = (delta / rect.width) * dur;
          return clampViewport({
            startMs: prev.startMs + dt,
            endMs: prev.endMs + dt,
          });
        }
        const cursorTime = prev.startMs + x * dur;
        const factor = Math.exp(delta * WHEEL_ZOOM_SENSITIVITY);
        const newDur = dur * factor;
        const newStart = cursorTime - x * newDur;
        return clampViewport({
          startMs: newStart,
          endMs: newStart + newDur,
        });
      });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [cancelAnimation, clampViewport]);

  // Drag-to-pan on the flame area; spans get click events on no-drag.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const el = flameAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const startX = e.clientX;
      const startVp = viewportRef.current;
      const dur = startVp.endMs - startVp.startMs;
      let dragged = false;
      cancelAnimation();

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        if (!dragged && Math.abs(dx) >= DRAG_THRESHOLD_PX) {
          dragged = true;
          isPanningRef.current = true;
          document.body.style.cursor = "grabbing";
        }
        if (!dragged) return;
        const dt = (dx / rect.width) * dur;
        setViewport(
          clampViewport({
            startMs: startVp.startMs - dt,
            endMs: startVp.endMs - dt,
          }),
        );
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        document.body.style.cursor = "";
        // Defer flag reset so synchronous click handlers see we just dragged.
        setTimeout(() => {
          isPanningRef.current = false;
        }, 0);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [cancelAnimation, clampViewport],
  );

  const handleSpanClick = useCallback(
    (spanId: string) => {
      if (isPanningRef.current) return;
      onSelectSpan(spanId);
      setFocusedSpanId(spanId);
    },
    [onSelectSpan],
  );

  const handleSpanDoubleClick = useCallback(
    (spanId: string) => {
      const node = tree.byId.get(spanId);
      if (!node) return;
      const dur = node.span.endTimeMs - node.span.startTimeMs;
      const pad = Math.max(dur * ZOOM_FIT_PADDING, 0);
      animateTo({
        startMs: node.span.startTimeMs - pad,
        endMs: node.span.endTimeMs + pad,
      });
      onSelectSpan(spanId);
      setFocusedSpanId(spanId);
    },
    [tree.byId, animateTo, onSelectSpan],
  );

  const handleResetZoom = useCallback(() => {
    animateTo(fullRange);
  }, [animateTo, fullRange]);

  const handleClearOnEmpty = useCallback(
    (e: React.MouseEvent) => {
      if (isPanningRef.current) return;
      // Only fire when click landed on the flame area itself (not a span).
      // Span onClick stops propagation, so this is the empty-space case.
      if (e.target !== e.currentTarget) {
        // Allow inner content box too (the absolute layer).
        const target = e.target as HTMLElement;
        if (target.dataset.flameLayer !== "true") return;
      }
      onClearSpan();
    },
    [onClearSpan],
  );

  // Ancestor chain of the focus span for breadcrumb navigation.
  const breadcrumbs = useMemo(() => {
    const id = focusedSpanId ?? selectedSpanId;
    if (!id) return [] as FlameNode[];
    const node = tree.byId.get(id);
    if (!node) return [] as FlameNode[];
    const chain: FlameNode[] = [];
    let curr: FlameNode | null = node;
    while (curr) {
      chain.unshift(curr);
      curr = curr.parent;
    }
    return chain;
  }, [focusedSpanId, selectedSpanId, tree.byId]);

  // Context span for the info strip: priority hover > focus > selection.
  const contextNode = useMemo<FlameNode | null>(() => {
    const id = hoveredSpanId ?? focusedSpanId ?? selectedSpanId;
    return id ? (tree.byId.get(id) ?? null) : null;
  }, [hoveredSpanId, focusedSpanId, selectedSpanId, tree.byId]);

  const contextInfo = useMemo<SpanContext | null>(() => {
    if (!contextNode) return null;
    return computeSpanContext(contextNode, fullRange);
  }, [contextNode, fullRange]);

  // Ancestors and descendants of the context span: drives relationship highlights.
  const relatedSpanIds = useMemo<{
    ancestors: Set<string>;
    descendants: Set<string>;
    parent: FlameNode | null;
    children: Set<string>;
  } | null>(() => {
    if (!contextNode) return null;
    const ancestors = new Set<string>();
    const descendants = new Set<string>();
    const childIds = new Set<string>();
    let curr = contextNode.parent;
    while (curr) {
      ancestors.add(curr.span.spanId);
      curr = curr.parent;
    }
    function collectDesc(n: FlameNode) {
      for (const c of n.children) {
        descendants.add(c.span.spanId);
        collectDesc(c);
      }
    }
    collectDesc(contextNode);
    for (const c of contextNode.children) childIds.add(c.span.spanId);
    return {
      ancestors,
      descendants,
      parent: contextNode.parent,
      children: childIds,
    };
  }, [contextNode]);

  // Drag-to-zoom on the time axis: drag horizontally to select a range, release to animate-zoom.
  const handleTimeAxisPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const el = timeAxisRef.current;
      if (!el) return;
      e.preventDefault();
      cancelAnimation();
      const rect = el.getBoundingClientRect();
      const startVp = viewportRef.current;
      const startDur = startVp.endMs - startVp.startMs;
      const xToTime = (clientX: number) => {
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return startVp.startMs + x * startDur;
      };
      const startTimeMs = xToTime(e.clientX);
      const startClientX = e.clientX;
      let dragged = false;

      const handleMove = (ev: PointerEvent) => {
        const dx = Math.abs(ev.clientX - startClientX);
        if (!dragged && dx >= DRAG_THRESHOLD_PX) dragged = true;
        if (!dragged) return;
        const t = xToTime(ev.clientX);
        setDragSelection({
          startMs: Math.min(startTimeMs, t),
          endMs: Math.max(startTimeMs, t),
        });
      };

      const handleUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        setDragSelection(null);
        if (!dragged) return;
        const t = xToTime(ev.clientX);
        const sel: Viewport = {
          startMs: Math.min(startTimeMs, t),
          endMs: Math.max(startTimeMs, t),
        };
        if (sel.endMs - sel.startMs >= MIN_VIEWPORT_MS) {
          animateTo(sel);
        }
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [animateTo, cancelAnimation],
  );

  const dur = viewport.endMs - viewport.startMs;
  const fullDur = fullRange.endMs - fullRange.startMs;
  const isZoomed = fullDur > 0 && dur < fullDur * 0.999;

  const visibleBlocks = useMemo(() => {
    if (dur <= 0) return tree.all;
    return tree.all.filter(
      (n) =>
        n.span.endTimeMs >= viewport.startMs &&
        n.span.startTimeMs <= viewport.endMs,
    );
  }, [tree.all, viewport.startMs, viewport.endMs, dur]);

  const hiddenSpanCount = useMemo(() => {
    if (visibleBlocks.length <= 200) return 0;
    let count = 0;
    for (const node of visibleBlocks) {
      const widthPct =
        ((node.span.endTimeMs - node.span.startTimeMs) / dur) * 100;
      if (widthPct < 0.1) count++;
    }
    return count;
  }, [visibleBlocks, dur]);

  const ticks = useMemo(
    () => generateTicks(viewport, fullRange.startMs),
    [viewport, fullRange.startMs],
  );

  const totalHeight = (tree.maxDepth + 1) * (ROW_HEIGHT + ROW_GAP);

  // Keyboard navigation. Uses functional setState so the listener is stable.
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
          e.preventDefault();
          const direction = e.key === "ArrowLeft" ? -1 : 1;
          if (e.shiftKey) {
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
              if (next) setFocusedSpanId(next.span.spanId);
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
  ]);

  if (spans.length === 0) {
    return (
      <Flex align="center" justify="center" height="full">
        <Text textStyle="xs" color="fg.subtle">
          No span data available
        </Text>
      </Flex>
    );
  }

  const dimOnHover = spans.length <= 100;

  return (
    <Flex
      ref={containerRef}
      direction="column"
      height="full"
      overflow="hidden"
      position="relative"
      tabIndex={0}
      outline="none"
      _focusVisible={{ outline: "none" }}
    >
      {/* Top bar: breadcrumbs + reset */}
      {(isZoomed || breadcrumbs.length > 0) && (
        <Flex
          align="center"
          justify="space-between"
          gap={2}
          paddingX={3}
          paddingY={1.5}
          flexShrink={0}
        >
          <HStack gap={0.5} flexWrap="nowrap" overflow="hidden" minWidth={0}>
            <Text
              as="button"
              textStyle="xs"
              color="fg.subtle"
              cursor="pointer"
              _hover={{ color: "fg" }}
              onClick={handleResetZoom}
              flexShrink={0}
            >
              root
            </Text>
            {breadcrumbs.map((node, i) => {
              const isLast = i === breadcrumbs.length - 1;
              const crumbDur = node.span.endTimeMs - node.span.startTimeMs;
              const parentDur = node.parent
                ? node.parent.span.endTimeMs - node.parent.span.startTimeMs
                : null;
              const pctOfParent =
                parentDur !== null && parentDur > 0
                  ? (crumbDur / parentDur) * 100
                  : null;
              return (
                <HStack key={node.span.spanId} gap={0} minWidth={0}>
                  <Icon as={LuChevronRight} boxSize={3} color="fg.subtle" />
                  <HStack
                    as="button"
                    gap={1}
                    paddingX={1}
                    paddingY={0.5}
                    borderRadius="sm"
                    cursor={isLast ? "default" : "pointer"}
                    _hover={isLast ? undefined : { bg: "bg.muted" }}
                    onClick={() =>
                      !isLast && handleSpanDoubleClick(node.span.spanId)
                    }
                  >
                    <Text
                      textStyle="xs"
                      color={isLast ? "fg" : "fg.muted"}
                      fontWeight={isLast ? "medium" : "normal"}
                      fontFamily="mono"
                      truncate
                      maxWidth="200px"
                    >
                      {node.span.name}
                    </Text>
                    <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
                      {formatDuration(crumbDur)}
                      {pctOfParent !== null
                        ? ` · ${formatPercent(pctOfParent)}`
                        : ""}
                    </Text>
                  </HStack>
                </HStack>
              );
            })}
          </HStack>
          {isZoomed && (
            <Tooltip
              content="Reset zoom (Esc)"
              positioning={{ placement: "top" }}
            >
              <Flex
                as="button"
                align="center"
                gap={1}
                paddingX={2}
                paddingY={0.5}
                borderRadius="sm"
                cursor="pointer"
                color="fg.muted"
                _hover={{ bg: "bg.muted", color: "fg" }}
                onClick={handleResetZoom}
                flexShrink={0}
              >
                <Icon as={LuRotateCcw} boxSize={3} />
                <Text textStyle="xs">Reset</Text>
              </Flex>
            </Tooltip>
          )}
        </Flex>
      )}

      {/* Context strip: parent ratio + trace ratio for hovered/focused span */}
      <Flex
        align="center"
        gap={2}
        paddingX={3}
        paddingY={1}
        flexShrink={0}
        height="26px"
        borderTopWidth="0.5px"
        borderBottomWidth="0.5px"
        borderColor="border.subtle"
        bg="bg.subtle"
      >
        {contextNode && contextInfo ? (
          <>
            <Text
              textStyle="xs"
              fontFamily="mono"
              fontWeight="medium"
              color="fg"
              truncate
              maxWidth="220px"
            >
              {contextNode.span.name}
            </Text>
            <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
              {formatDuration(contextInfo.duration)}
            </Text>
            {contextInfo.pctOfParent !== null &&
              contextInfo.parentName !== null &&
              contextInfo.parentDuration !== null && (
                <HStack gap={1} minWidth={0}>
                  <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
                    →
                  </Text>
                  <Text
                    textStyle="xs"
                    color="fg.emphasized"
                    fontWeight="semibold"
                    whiteSpace="nowrap"
                  >
                    {formatPercent(contextInfo.pctOfParent)}
                  </Text>
                  <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
                    of
                  </Text>
                  <Text
                    textStyle="xs"
                    color="fg.muted"
                    fontFamily="mono"
                    truncate
                    maxWidth="160px"
                  >
                    {contextInfo.parentName}
                  </Text>
                  <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
                    ({formatDuration(contextInfo.parentDuration)})
                  </Text>
                </HStack>
              )}
            {contextInfo.pctOfTrace !== null && (
              <Text textStyle="xs" color="fg.subtle" whiteSpace="nowrap">
                · {formatPercent(contextInfo.pctOfTrace)} of trace
              </Text>
            )}
          </>
        ) : (
          <Text textStyle="xs" color="fg.subtle">
            {spans.length} span{spans.length === 1 ? "" : "s"} ·{" "}
            {formatDuration(fullDur)} · hover a span for details
          </Text>
        )}
      </Flex>

      {/* Time axis: drag to zoom into a range */}
      <Tooltip
        content="Drag horizontally to zoom into a range · scroll to zoom · drag flame to pan"
        positioning={{ placement: "bottom" }}
        openDelay={400}
      >
        <Box
          ref={timeAxisRef}
          position="relative"
          height="28px"
          flexShrink={0}
          paddingX={3}
          cursor="ew-resize"
          userSelect="none"
          onPointerDown={handleTimeAxisPointerDown}
          bg="bg.subtle"
          _hover={{ bg: "bg.muted" }}
          transition="background-color 0.1s ease"
          borderTopWidth="0.5px"
          borderBottomWidth="0.5px"
          borderColor="border.subtle"
          className="flame-time-axis"
          css={{
            "&:hover .flame-time-axis-hint": { opacity: 0.95 },
          }}
        >
          {/* Tick lines + labels (ruler-like) */}
          {ticks.map((tick, i) => {
            const offset = (tick.time - viewport.startMs) / dur;
            if (offset < -0.001 || offset > 1.001) return null;
            const left = `calc(12px + ${offset} * (100% - 24px))`;
            return (
              <Box key={i} pointerEvents="none">
                <Box
                  position="absolute"
                  left={left}
                  bottom={0}
                  width="1px"
                  height="6px"
                  bg="border.emphasized"
                  opacity={0.6}
                />
                <Text
                  textStyle="xs"
                  color="fg.muted"
                  position="absolute"
                  left={left}
                  transform="translateX(-50%)"
                  whiteSpace="nowrap"
                  userSelect="none"
                  top="3px"
                  fontFamily="mono"
                >
                  {tick.label}
                </Text>
              </Box>
            );
          })}

          {/* Persistent drag-to-zoom affordance */}
          <Flex
            className="flame-time-axis-hint"
            position="absolute"
            right={3}
            top="50%"
            transform="translateY(-50%)"
            align="center"
            gap={1}
            paddingX={1.5}
            paddingY={0.5}
            borderRadius="sm"
            bg="bg.panel"
            borderWidth="0.5px"
            borderColor="border.subtle"
            color="fg.muted"
            pointerEvents="none"
            opacity={0.75}
            transition="opacity 0.15s ease"
            boxShadow="xs"
          >
            <Text
              textStyle="2xs"
              fontWeight="semibold"
              letterSpacing="0.04em"
              textTransform="uppercase"
              whiteSpace="nowrap"
              lineHeight={1}
            >
              ↔ drag to zoom
            </Text>
          </Flex>
        </Box>
      </Tooltip>

      {/* Flame area */}
      <Box
        ref={flameAreaRef}
        flex={1}
        overflow="auto"
        position="relative"
        paddingX={3}
        paddingBottom={2}
        cursor="grab"
        _active={{ cursor: "grabbing" }}
        onPointerDown={handlePointerDown}
        onClick={handleClearOnEmpty}
        css={{
          "&::-webkit-scrollbar": { width: "4px", height: "4px" },
          "&::-webkit-scrollbar-thumb": {
            borderRadius: "4px",
            background: "var(--chakra-colors-border-muted)",
          },
          "&::-webkit-scrollbar-track": { background: "transparent" },
        }}
      >
        <Box
          data-flame-layer="true"
          position="relative"
          minHeight={`${Math.max(totalHeight, 32)}px`}
          userSelect="none"
        >
          {/* Tick grid lines */}
          {ticks.map((tick, i) => {
            const offset = (tick.time - viewport.startMs) / dur;
            if (offset < 0 || offset > 1) return null;
            return (
              <Box
                key={`grid-${i}`}
                position="absolute"
                top={0}
                bottom={0}
                left={`${offset * 100}%`}
                width="1px"
                bg="border.subtle"
                opacity={0.5}
                pointerEvents="none"
              />
            );
          })}

          {/* Parent time-range band: highlights the parent's slice of time when hovering a child */}
          {relatedSpanIds?.parent &&
            (() => {
              const p = relatedSpanIds.parent.span;
              const left =
                dur > 0 ? ((p.startTimeMs - viewport.startMs) / dur) * 100 : 0;
              const width =
                dur > 0 ? ((p.endTimeMs - p.startTimeMs) / dur) * 100 : 100;
              if (left + width < 0 || left > 100) return null;
              return (
                <>
                  <Box
                    position="absolute"
                    left={`${left}%`}
                    width={`${width}%`}
                    top={0}
                    bottom={0}
                    bg="bg.emphasized"
                    opacity={0.18}
                    pointerEvents="none"
                    zIndex={0}
                  />
                  <Box
                    position="absolute"
                    left={`${left}%`}
                    top={0}
                    bottom={0}
                    width="1px"
                    bg="fg.muted"
                    opacity={0.5}
                    pointerEvents="none"
                    zIndex={0}
                  />
                  <Box
                    position="absolute"
                    left={`${left + width}%`}
                    top={0}
                    bottom={0}
                    width="1px"
                    bg="fg.muted"
                    opacity={0.5}
                    pointerEvents="none"
                    zIndex={0}
                  />
                </>
              );
            })()}

          {/* Row striping for depth readability */}
          {Array.from({ length: tree.maxDepth + 1 }).map((_, depth) =>
            depth % 2 === 1 ? (
              <Box
                key={`row-${depth}`}
                position="absolute"
                top={`${depth * (ROW_HEIGHT + ROW_GAP)}px`}
                left={0}
                right={0}
                height={`${ROW_HEIGHT}px`}
                bg="bg.subtle"
                opacity={0.5}
                pointerEvents="none"
              />
            ) : null,
          )}

          {/* Span blocks */}
          {visibleBlocks.map((node) => {
            const { span, depth } = node;
            const spanDur = span.endTimeMs - span.startTimeMs;
            const top = depth * (ROW_HEIGHT + ROW_GAP);
            const leftPct =
              dur > 0 ? ((span.startTimeMs - viewport.startMs) / dur) * 100 : 0;
            const widthPct = dur > 0 ? (spanDur / dur) * 100 : 100;

            // Skip ultra-narrow blocks at large traces (perf).
            if (widthPct < 0.05 && spans.length > 200) return null;

            const color =
              (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
            const depthAlpha = Math.max(
              DEPTH_FADE_FLOOR,
              1 - depth * DEPTH_FADE_STEP,
            );
            const isError = span.status === "error";
            const isSelected = span.spanId === selectedSpanId;
            const isHovered = span.spanId === hoveredSpanId;
            const isFocused = span.spanId === focusedSpanId && !isSelected;
            const isAncestor =
              relatedSpanIds?.ancestors.has(span.spanId) ?? false;
            const isDirectChild =
              relatedSpanIds?.children.has(span.spanId) ?? false;
            const isDescendant =
              relatedSpanIds?.descendants.has(span.spanId) ?? false;
            const isRelated =
              isAncestor ||
              isDescendant ||
              isSelected ||
              isHovered ||
              isFocused;
            const isEmphasized = isSelected || isHovered || isFocused;
            const isDimmed = dimOnHover && !!relatedSpanIds && !isRelated;
            const bgAlphaPct = Math.round(
              (isEmphasized
                ? 1
                : isAncestor
                  ? Math.max(depthAlpha, 0.85)
                  : isDirectChild
                    ? Math.max(depthAlpha, 0.8)
                    : isDimmed
                      ? depthAlpha * 0.3
                      : depthAlpha) * 100,
            );
            const isZeroDuration = spanDur === 0;

            const parentDurMs = node.parent
              ? node.parent.span.endTimeMs - node.parent.span.startTimeMs
              : null;
            const pctOfParent =
              parentDurMs !== null && parentDurMs > 0
                ? (spanDur / parentDurMs) * 100
                : null;
            const pctOfTrace = fullDur > 0 ? (spanDur / fullDur) * 100 : null;

            const tooltipLines = [
              span.name,
              `Duration: ${isZeroDuration ? "<1ms" : formatDuration(spanDur)}`,
              pctOfParent !== null && node.parent
                ? `${formatPercent(pctOfParent)} of parent (${node.parent.span.name}, ${formatDuration(parentDurMs ?? 0)})`
                : null,
              pctOfTrace !== null && node.parent
                ? `${formatPercent(pctOfTrace)} of trace`
                : null,
              span.model ? `Model: ${span.model}` : null,
              node.isOrphaned ? "⚠ Parent not in trace" : null,
            ].filter(Boolean);

            // Visual hierarchy: selected > focused > hovered > ancestor/child > rest.
            const borderWidth = isError
              ? "1.5px"
              : isSelected
                ? "2px"
                : isFocused
                  ? "1.5px"
                  : isAncestor || isDirectChild
                    ? "1px"
                    : "0.5px";
            const borderColor = isError
              ? "red.solid"
              : isSelected
                ? "fg"
                : isFocused
                  ? "fg.muted"
                  : isAncestor
                    ? "fg.muted"
                    : isDirectChild
                      ? "border.emphasized"
                      : "blackAlpha.200";
            const boxShadow = isSelected
              ? "0 0 0 2px var(--chakra-colors-bg-panel), 0 2px 8px rgba(0,0,0,0.18)"
              : isHovered
                ? "sm"
                : undefined;

            return (
              <Tooltip
                key={span.spanId}
                content={tooltipLines.join("\n")}
                positioning={{ placement: "top" }}
              >
                <Box
                  position="absolute"
                  top={`${top}px`}
                  left={`${leftPct}%`}
                  width={`${widthPct}%`}
                  minWidth={`${MIN_BLOCK_PX}px`}
                  height={`${ROW_HEIGHT}px`}
                  bg={`${color}/${bgAlphaPct}`}
                  borderWidth={borderWidth}
                  borderColor={borderColor}
                  borderStyle={node.isOrphaned ? "dashed" : "solid"}
                  borderRadius="sm"
                  cursor="pointer"
                  overflow="hidden"
                  zIndex={isSelected ? 3 : isFocused || isHovered ? 2 : 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSpanClick(span.spanId);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleSpanDoubleClick(span.spanId);
                  }}
                  onMouseEnter={() => setHoveredSpanId(span.spanId)}
                  onMouseLeave={() => setHoveredSpanId(null)}
                  display="flex"
                  alignItems="center"
                  paddingX={1}
                  boxShadow={boxShadow}
                >
                  <Text
                    textStyle="xs"
                    color={isEmphasized ? "white" : "whiteAlpha.900"}
                    truncate
                    lineHeight={1}
                    userSelect="none"
                    textShadow="0 1px 1px rgba(0,0,0,0.35)"
                  >
                    <BlockLabel
                      name={span.name}
                      duration={spanDur}
                      model={span.type === "llm" ? span.model : null}
                      pctOfParent={pctOfParent}
                      widthPct={widthPct}
                    />
                  </Text>
                </Box>
              </Tooltip>
            );
          })}
        </Box>

        {/* Drag-to-zoom selection overlay */}
        {dragSelection &&
          (() => {
            const selDur = dragSelection.endMs - dragSelection.startMs;
            const left =
              dur > 0
                ? ((dragSelection.startMs - viewport.startMs) / dur) * 100
                : 0;
            const width = dur > 0 ? (selDur / dur) * 100 : 0;
            return (
              <Box
                position="absolute"
                top={0}
                bottom={0}
                left={`calc(12px + ${left / 100} * (100% - 24px))`}
                width={`calc(${width / 100} * (100% - 24px))`}
                pointerEvents="none"
                zIndex={20}
              >
                <Box
                  position="absolute"
                  inset={0}
                  bg="blue.solid"
                  opacity={0.18}
                  borderLeftWidth="1.5px"
                  borderRightWidth="1.5px"
                  borderColor="blue.solid"
                />
                <Flex
                  position="absolute"
                  top={1}
                  left="50%"
                  transform="translateX(-50%)"
                  paddingX={2}
                  paddingY={0.5}
                  bg="blue.solid"
                  color="white"
                  borderRadius="sm"
                  boxShadow="md"
                  whiteSpace="nowrap"
                >
                  <Text textStyle="xs" fontFamily="mono" fontWeight="medium">
                    {formatDuration(selDur)}
                  </Text>
                </Flex>
              </Box>
            );
          })()}

        {hiddenSpanCount > 0 && (
          <Flex justify="center" paddingY={1}>
            <Text textStyle="xs" color="fg.subtle">
              {hiddenSpanCount} span{hiddenSpanCount !== 1 ? "s" : ""} too small
              to display — zoom in to see
            </Text>
          </Flex>
        )}
      </Box>

      {/* Minimap (always-on while there's a duration) */}
      {fullDur > 0 && (
        <Minimap
          allNodes={tree.all}
          maxDepth={tree.maxDepth}
          fullRange={fullRange}
          viewport={viewport}
          onViewport={(v) => {
            cancelAnimation();
            setViewport(clampViewport(v));
          }}
          onReset={handleResetZoom}
        />
      )}
    </Flex>
  );
}

function Minimap({
  allNodes,
  maxDepth,
  fullRange,
  viewport,
  onViewport,
  onReset,
}: {
  allNodes: FlameNode[];
  maxDepth: number;
  fullRange: Viewport;
  viewport: Viewport;
  onViewport: (v: Viewport) => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fullDur = fullRange.endMs - fullRange.startMs;
  const vpDur = viewport.endMs - viewport.startMs;

  const handleAreaClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || fullDur <= 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      const center = fullRange.startMs + x * fullDur;
      onViewport({
        startMs: center - vpDur / 2,
        endMs: center + vpDur / 2,
      });
    },
    [fullRange.startMs, fullDur, vpDur, onViewport],
  );

  const handleViewportPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || fullDur <= 0) return;
      const startX = e.clientX;
      const startVp = viewport;
      document.body.style.cursor = "grabbing";

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dt = (dx / rect.width) * fullDur;
        onViewport({
          startMs: startVp.startMs + dt,
          endMs: startVp.endMs + dt,
        });
      };

      const handleUp = () => {
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [viewport, fullDur, onViewport],
  );

  const handleEdgePointerDown = useCallback(
    (edge: "left" | "right") => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const rect = ref.current?.getBoundingClientRect();
      if (!rect || fullDur <= 0) return;
      const startX = e.clientX;
      const startVp = viewport;
      document.body.style.cursor = "ew-resize";

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dt = (dx / rect.width) * fullDur;
        if (edge === "left") {
          const proposed = startVp.startMs + dt;
          const maxStart = startVp.endMs - MIN_VIEWPORT_MS;
          onViewport({
            startMs: Math.min(proposed, maxStart),
            endMs: startVp.endMs,
          });
        } else {
          const proposed = startVp.endMs + dt;
          const minEnd = startVp.startMs + MIN_VIEWPORT_MS;
          onViewport({
            startMs: startVp.startMs,
            endMs: Math.max(proposed, minEnd),
          });
        }
      };

      const handleUp = () => {
        document.body.style.cursor = "";
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [viewport, fullDur, onViewport],
  );

  if (fullDur <= 0) return null;

  const headerH = 14;
  const innerH = MINIMAP_HEIGHT - headerH - 4;
  const rowH = Math.max(1, innerH / (maxDepth + 1));
  const vpLeft = ((viewport.startMs - fullRange.startMs) / fullDur) * 100;
  const vpWidth = Math.max(0.5, (vpDur / fullDur) * 100);
  const minimapTickFractions = [0.25, 0.5, 0.75];

  return (
    <Tooltip
      content="Drag the bracket to pan · drag the edges to resize zoom · click to recenter · double-click to reset"
      positioning={{ placement: "top" }}
      openDelay={500}
    >
      <Box
        ref={ref}
        position="absolute"
        bottom={3}
        right={3}
        width={`${MINIMAP_WIDTH}px`}
        height={`${MINIMAP_HEIGHT}px`}
        borderRadius="md"
        bg="bg.panel"
        overflow="hidden"
        cursor="pointer"
        onClick={handleAreaClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onReset();
        }}
        borderWidth="1px"
        borderColor="border.emphasized"
        boxShadow="lg"
        zIndex={2}
      >
        {/* Header strip */}
        <Flex
          position="absolute"
          top={0}
          left={0}
          right={0}
          height={`${headerH}px`}
          align="center"
          justify="space-between"
          paddingX={2}
          bg="bg.muted"
          borderBottomWidth="0.5px"
          borderColor="border.subtle"
          pointerEvents="none"
        >
          <Text
            textStyle="2xs"
            fontWeight="semibold"
            letterSpacing="0.04em"
            textTransform="uppercase"
            color="fg.muted"
            lineHeight={1}
          >
            Overview
          </Text>
          <Text
            textStyle="2xs"
            color="fg.subtle"
            fontFamily="mono"
            lineHeight={1}
          >
            {formatDuration(fullDur)}
          </Text>
        </Flex>

        {/* Span dot area */}
        <Box
          position="absolute"
          top={`${headerH}px`}
          left={0}
          right={0}
          bottom={0}
        >
          {/* Quartile tick guide lines */}
          {minimapTickFractions.map((f) => (
            <Box
              key={f}
              position="absolute"
              left={`${f * 100}%`}
              top={0}
              bottom={0}
              width="1px"
              bg="border.subtle"
              opacity={0.6}
              pointerEvents="none"
            />
          ))}

          {/* Span dots */}
          {allNodes.map((node) => {
            const left =
              ((node.span.startTimeMs - fullRange.startMs) / fullDur) * 100;
            const width = Math.max(
              0.2,
              ((node.span.endTimeMs - node.span.startTimeMs) / fullDur) * 100,
            );
            const top = 2 + node.depth * rowH;
            const color =
              (SPAN_TYPE_COLORS[node.span.type ?? "span"] as string) ??
              "gray.solid";
            return (
              <Box
                key={node.span.spanId}
                position="absolute"
                left={`${left}%`}
                width={`${width}%`}
                top={`${top}px`}
                height={`${Math.max(1, rowH - 0.5)}px`}
                bg={color}
                opacity={0.75}
                minWidth="1px"
                pointerEvents="none"
                borderRadius="xs"
              />
            );
          })}

          {/* Outside-viewport dim */}
          <Box
            position="absolute"
            left={0}
            width={`${Math.max(0, vpLeft)}%`}
            top={0}
            bottom={0}
            bg="blackAlpha.500"
            pointerEvents="none"
          />
          <Box
            position="absolute"
            left={`${vpLeft + vpWidth}%`}
            right={0}
            top={0}
            bottom={0}
            bg="blackAlpha.500"
            pointerEvents="none"
          />

          {/* Viewport indicator: edge handles + draggable middle */}
          <Box
            position="absolute"
            left={`${vpLeft}%`}
            width={`${vpWidth}%`}
            top={0}
            bottom={0}
            borderTopWidth="2px"
            borderBottomWidth="2px"
            borderColor="blue.solid"
            bg="blue.solid/12"
            borderRadius="sm"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left resize handle */}
            <Flex
              position="absolute"
              left={0}
              top={0}
              bottom={0}
              width={`${MINIMAP_HANDLE_PX}px`}
              align="center"
              justify="center"
              bg="blue.solid"
              cursor="ew-resize"
              onPointerDown={handleEdgePointerDown("left")}
              borderTopLeftRadius="sm"
              borderBottomLeftRadius="sm"
              _hover={{ bg: "blue.fg" }}
              transition="background-color 0.1s ease"
            >
              <HandleGrip />
            </Flex>
            {/* Pan middle */}
            <Box
              position="absolute"
              left={`${MINIMAP_HANDLE_PX}px`}
              right={`${MINIMAP_HANDLE_PX}px`}
              top={0}
              bottom={0}
              cursor="grab"
              _active={{ cursor: "grabbing" }}
              onPointerDown={handleViewportPointerDown}
            />
            {/* Right resize handle */}
            <Flex
              position="absolute"
              right={0}
              top={0}
              bottom={0}
              width={`${MINIMAP_HANDLE_PX}px`}
              align="center"
              justify="center"
              bg="blue.solid"
              cursor="ew-resize"
              onPointerDown={handleEdgePointerDown("right")}
              borderTopRightRadius="sm"
              borderBottomRightRadius="sm"
              _hover={{ bg: "blue.fg" }}
              transition="background-color 0.1s ease"
            >
              <HandleGrip />
            </Flex>
          </Box>
        </Box>
      </Box>
    </Tooltip>
  );
}

function HandleGrip() {
  return (
    <Flex direction="column" gap="2px" pointerEvents="none">
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          width="2px"
          height="2px"
          borderRadius="full"
          bg="white"
          opacity={0.85}
        />
      ))}
    </Flex>
  );
}

function BlockLabel({
  name,
  duration,
  model,
  pctOfParent,
  widthPct,
}: {
  name: string;
  duration: number;
  model: string | null;
  pctOfParent: number | null;
  widthPct: number;
}) {
  if (widthPct < 2) return null;
  if (widthPct < 5) return <>{name.slice(0, 8)}</>;
  const dur = formatDuration(duration);
  const pct = pctOfParent !== null ? ` · ${formatPercent(pctOfParent)}` : "";
  if (widthPct >= 18 && model) {
    return (
      <>
        {name} ({dur}
        {pct}) · {model.split("/").pop()}
      </>
    );
  }
  if (widthPct >= 10) {
    return (
      <>
        {name} ({dur}
        {pct})
      </>
    );
  }
  if (widthPct >= 8) {
    return (
      <>
        {name} ({dur})
      </>
    );
  }
  return <>{name}</>;
}
