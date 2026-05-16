import { Box, Flex } from "@chakra-ui/react";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { SPAN_TYPE_COLORS } from "../../../utils/formatters";
import {
  BAR_HEIGHT,
  GROUP_ROW_HEIGHT,
  MIN_BAR_PX,
  type SiblingGroup,
} from "./types";

export function TimelineBar({
  span,
  rootStart,
  rootDuration,
  rowHeight,
  isSelected,
  isHovered,
  isDimmed,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: {
  span: SpanTreeNode;
  rootStart: number;
  rootDuration: number;
  rowHeight: number;
  isSelected: boolean;
  isHovered: boolean;
  isDimmed: boolean;
  onSelect: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  const isError = span.status === "error";
  const duration = span.durationMs;
  const color =
    (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
  const isZeroDuration = duration === 0;

  const leftPct =
    rootDuration > 0
      ? ((span.startTimeMs - rootStart) / rootDuration) * 100
      : 0;
  const widthPct = rootDuration > 0 ? (duration / rootDuration) * 100 : 50;

  return (
    <Flex
      height={`${rowHeight}px`}
      align="center"
      position="relative"
      cursor="pointer"
      onClick={onSelect}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      transition="background 0.1s ease, opacity 0.1s ease"
      // Light mode: neutral grey for selection so the non-selected rows
      // don't need to be dimmed to stay legible — they keep full opacity.
      // Dark mode: blue tint reads well against the dark panel.
      bg={
        isSelected
          ? { base: "bg.emphasized", _dark: "blue.subtle" }
          : isHovered
            ? "bg.muted"
            : undefined
      }
      // Dark mode: fade non-selected bars when one is selected so the
      // focus bar pops. Light mode keeps full opacity — the bg fill is
      // enough of a focal anchor there.
      opacity={{
        base: 1,
        _dark: isDimmed && !isSelected && !isHovered ? 0.4 : 1,
      }}
    >
      {/* Bars live inside a smaller positioned containing block so the
          row's hover / selection background can still extend
          edge-to-edge while the bars themselves stay clear of the pane
          edge / resize divider. left/right here mirror the inset used
          by the time markers in WaterfallView's header. */}
      <Box position="absolute" top={0} bottom={0} left={2} right={4}>
        {isZeroDuration ? (
          /* Diamond marker for 0ms spans */
          <Box
            position="absolute"
            top="50%"
            left={`calc(${leftPct}% - 4px)`}
            width="8px"
            height="8px"
            transform="translateY(-50%) rotate(45deg)"
            bg={isError ? "red.solid" : color}
            borderWidth={isSelected ? "1px" : "0px"}
            borderColor="border.emphasized"
            opacity={0.85}
          />
        ) : (
          <Box
            position="absolute"
            top="50%"
            left={`${leftPct}%`}
            width={`${widthPct}%`}
            minWidth={`${MIN_BAR_PX}px`}
            height={`${BAR_HEIGHT}px`}
            transform="translateY(-50%)"
            borderRadius="sm"
            bg={color}
            opacity={isSelected ? 0.95 : isHovered ? 0.85 : 0.7}
            borderWidth={isError ? "1.5px" : isSelected ? "1px" : "0px"}
            borderColor={
              isError
                ? "red.solid"
                : isSelected
                  ? "border.emphasized"
                  : undefined
            }
            transition="opacity 0.1s ease"
            boxShadow={
              isSelected
                ? "0 1px 3px 0 rgba(0,0,0,0.1)"
                : isHovered
                  ? "0 1px 2px 0 rgba(0,0,0,0.06)"
                  : undefined
            }
          />
        )}
      </Box>
    </Flex>
  );
}

export function GroupTimelineBar({
  group,
  rootStart,
  rootDuration,
}: {
  group: SiblingGroup;
  rootStart: number;
  rootDuration: number;
}) {
  const color = (SPAN_TYPE_COLORS[group.type] as string) ?? "gray.solid";
  const leftPct =
    rootDuration > 0 ? ((group.minStart - rootStart) / rootDuration) * 100 : 0;
  const widthPct =
    rootDuration > 0
      ? ((group.maxEnd - group.minStart) / rootDuration) * 100
      : 50;

  return (
    <Flex
      height={`${GROUP_ROW_HEIGHT}px`}
      align="center"
      position="relative"
    >
      <Box position="absolute" top={0} bottom={0} left={2} right={4}>
        <Box
          position="absolute"
          top="50%"
          left={`${leftPct}%`}
          width={`${widthPct}%`}
          minWidth={`${MIN_BAR_PX}px`}
          height={`${BAR_HEIGHT}px`}
          transform="translateY(-50%)"
          borderRadius="sm"
          bg={color}
          opacity={0.45}
          css={{
            backgroundImage: `repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 3px,
              rgba(255,255,255,0.15) 3px,
              rgba(255,255,255,0.15) 6px
            )`,
          }}
        />
      </Box>
    </Flex>
  );
}
