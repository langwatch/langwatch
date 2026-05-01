import { Box, Flex, Text } from "@chakra-ui/react";
import { useCallback, useRef } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { formatDuration, SPAN_TYPE_COLORS } from "../../../utils/formatters";
import {
  MIN_VIEWPORT_MS,
  MINIMAP_HANDLE_PX,
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
} from "./constants";
import type { FlameNode, Viewport } from "./types";

export function Minimap({
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
            bg="black/50"
            pointerEvents="none"
          />
          <Box
            position="absolute"
            left={`${vpLeft + vpWidth}%`}
            right={0}
            top={0}
            bottom={0}
            bg="black/50"
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
