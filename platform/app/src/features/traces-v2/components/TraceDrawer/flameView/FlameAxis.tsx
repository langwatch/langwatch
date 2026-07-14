import { Box, Flex, Text } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import type { Viewport } from "./types";

interface FlameAxisProps {
  timeAxisRef: React.RefObject<HTMLDivElement | null>;
  ticks: { time: number; label: string }[];
  viewport: Viewport;
  dur: number;
  onPointerDown: (e: React.PointerEvent) => void;
}

/**
 * Time axis ruler — shows tick marks + labels, drag-to-zoom affordance.
 * The box is the drag target for useFlameAxisZoom; ticks are rendered
 * absolutely within it so they line up with the flame rows below.
 */
export function FlameAxis({
  timeAxisRef,
  ticks,
  viewport,
  dur,
  onPointerDown,
}: FlameAxisProps) {
  return (
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
        onPointerDown={onPointerDown}
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
  );
}
