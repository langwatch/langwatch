import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuChevronRight, LuRotateCcw } from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";
import { formatDuration, SPAN_TYPE_COLORS } from "../../../utils/formatters";
import { BlockLabel } from "./BlockLabel";
import {
  DEPTH_FADE_FLOOR,
  DEPTH_FADE_STEP,
  DRAG_THRESHOLD_PX,
  MIN_BLOCK_PX,
  MIN_VIEWPORT_MS,
  ROW_GAP,
  ROW_HEIGHT,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_ANIMATION_MS,
  ZOOM_FIT_PADDING,
} from "./constants";
import { Minimap } from "./Minimap";
import {
  buildTree,
  computeSpanContext,
  formatPercent,
  generateTicks,
} from "./tree";
import type { FlameNode, FlameViewProps, SpanContext, Viewport } from "./types";

export const FlameView = memo(function FlameView({
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

  // Group visible blocks by depth so the virtualizer can render each row's
  // contents independently without scanning the full list per row.
  const blocksByDepth = useMemo(() => {
    const map = new Map<number, FlameNode[]>();
    for (const node of visibleBlocks) {
      const list = map.get(node.depth);
      if (list) list.push(node);
      else map.set(node.depth, [node]);
    }
    return map;
  }, [visibleBlocks]);

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

  const rowSize = ROW_HEIGHT + ROW_GAP;
  const totalHeight = (tree.maxDepth + 1) * rowSize;

  // Virtualize one row per depth level. The flame area itself is the scroll
  // container — `getScrollElement` returns its ref. Each virtual item renders
  // the depth-stripe + the spans at that depth (positioned absolutely in time).
  const getScrollElement = useCallback(() => flameAreaRef.current, []);
  const estimateSize = useCallback(() => rowSize, [rowSize]);

  const virtualizer = useVirtualizer({
    count: tree.maxDepth + 1,
    getScrollElement,
    estimateSize,
    overscan: 4,
  });

  const virtualRows = virtualizer.getVirtualItems();

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
              content={
                <HStack gap={1}>
                  <Text>Reset zoom</Text>
                  <Kbd>Esc</Kbd>
                </HStack>
              }
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
          {ticks.map((tick) => {
            const offset = (tick.time - viewport.startMs) / dur;
            if (offset < -0.001 || offset > 1.001) return null;
            const left = `calc(12px + ${offset} * (100% - 24px))`;
            return (
              <Box key={`${tick.label}-${tick.time}`} pointerEvents="none">
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

      {/* Flame area — vertical scroll container for the row virtualizer */}
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
          height={`${Math.max(totalHeight, 32)}px`}
          userSelect="none"
        >
          {/* Tick grid lines (full layer height — outside virtualization) */}
          {ticks.map((tick) => {
            const offset = (tick.time - viewport.startMs) / dur;
            if (offset < 0 || offset > 1) return null;
            return (
              <Box
                key={`grid-${tick.label}-${tick.time}`}
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

          {/* Virtualized depth rows — only renders rows visible in the scroll container */}
          {virtualRows.map((virtualRow) => {
            const depth = virtualRow.index;
            const rowNodes = blocksByDepth.get(depth);
            const isStripe = depth % 2 === 1;
            return (
              <Box
                key={virtualRow.key}
                position="absolute"
                top={0}
                left={0}
                right={0}
                height={`${virtualRow.size}px`}
                transform={`translateY(${virtualRow.start}px)`}
                pointerEvents="none"
              >
                {isStripe && (
                  <Box
                    position="absolute"
                    top={0}
                    left={0}
                    right={0}
                    height={`${ROW_HEIGHT}px`}
                    bg="bg.subtle"
                    opacity={0.5}
                    pointerEvents="none"
                  />
                )}
                {rowNodes?.map((node) => {
                  const { span } = node;
                  const spanDur = span.endTimeMs - span.startTimeMs;
                  const leftPct =
                    dur > 0
                      ? ((span.startTimeMs - viewport.startMs) / dur) * 100
                      : 0;
                  const widthPct = dur > 0 ? (spanDur / dur) * 100 : 100;

                  // Skip ultra-narrow blocks at large traces (perf).
                  if (widthPct < 0.05 && spans.length > 200) return null;

                  const color =
                    (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ??
                    "gray.solid";
                  const depthAlpha = Math.max(
                    DEPTH_FADE_FLOOR,
                    1 - depth * DEPTH_FADE_STEP,
                  );
                  const isError = span.status === "error";
                  const isSelected = span.spanId === selectedSpanId;
                  const isHovered = span.spanId === hoveredSpanId;
                  const isFocused =
                    span.spanId === focusedSpanId && !isSelected;
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
                  const pctOfTrace =
                    fullDur > 0 ? (spanDur / fullDur) * 100 : null;

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
                            : "border.muted";
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
                        top={0}
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
                        pointerEvents="auto"
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
});
