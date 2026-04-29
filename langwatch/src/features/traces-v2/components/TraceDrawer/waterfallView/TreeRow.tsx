import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import {
  LuChevronDown,
  LuChevronRight,
  LuTriangleAlert,
  LuUnlink,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { LangwatchSignalBucket } from "~/server/api/routers/tracesV2.schemas";
import {
  abbreviateModel,
  formatDuration,
  SPAN_TYPE_COLORS,
} from "../../../utils/formatters";
import { LangwatchSignalBadges } from "../LangwatchSignalBadges";
import { TipCell } from "./TipCell";
import {
  INDENT_PX,
  LLM_ROW_HEIGHT,
  ROW_HEIGHT,
  SPAN_TYPE_ICONS,
  type WaterfallTreeNode,
} from "./types";

export function TreeRow({
  node,
  rootStart,
  rootDuration,
  isSelected,
  isHovered,
  isCollapsed,
  hasChildren,
  isDimmed,
  signals,
  onToggleCollapse,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: {
  node: WaterfallTreeNode;
  rootStart: number;
  rootDuration: number;
  isSelected: boolean;
  isHovered: boolean;
  isCollapsed: boolean;
  hasChildren: boolean;
  isDimmed: boolean;
  signals: readonly LangwatchSignalBucket[];
  onToggleCollapse: () => void;
  onSelect: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  const { span, depth, isOrphaned } = node;
  const isError = span.status === "error";
  const color =
    (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
  const isLlm = span.type === "llm" && span.model != null;
  const rowH = isLlm ? LLM_ROW_HEIGHT : ROW_HEIGHT;
  const icon = SPAN_TYPE_ICONS[span.type ?? "span"] ?? "○";
  const duration = span.durationMs;
  const isZeroDuration = duration === 0;
  const offsetMs = Math.max(0, span.startTimeMs - rootStart);
  const sharePct =
    rootDuration > 0 ? Math.round((duration / rootDuration) * 100) : 0;

  const tooltipContent = (
    <Box minWidth="240px" maxWidth="340px">
      <Text
        textStyle="xs"
        fontWeight="semibold"
        color="fg"
        wordBreak="break-word"
      >
        {span.name}
      </Text>
      <HStack gap={1.5} marginTop={1} flexWrap="wrap">
        <Text
          textStyle="2xs"
          color={color}
          paddingX={1.5}
          borderRadius="sm"
          borderWidth="1px"
          borderColor={color}
          fontWeight="semibold"
        >
          {(span.type ?? "span").toUpperCase()}
        </Text>
        {isError && (
          <Text
            textStyle="2xs"
            color="red.fg"
            paddingX={1.5}
            borderRadius="sm"
            bg="red.subtle"
            fontWeight="semibold"
          >
            ERROR
          </Text>
        )}
        {span.model && (
          <Text textStyle="2xs" color="fg.muted" fontFamily="mono">
            {span.model}
          </Text>
        )}
      </HStack>
      <Box
        marginTop={1.5}
        display="grid"
        gridTemplateColumns="auto 1fr"
        gap={0.5}
        columnGap={3}
      >
        <TipCell
          label="Duration"
          value={isZeroDuration ? "<1ms" : formatDuration(duration)}
        />
        {sharePct > 0 && <TipCell label="Of trace" value={`${sharePct}%`} />}
        <TipCell label="Offset" value={`+${formatDuration(offsetMs)}`} />
        <TipCell label="Span ID" value={span.spanId.slice(0, 16)} mono />
        {span.parentSpanId && (
          <TipCell label="Parent" value={span.parentSpanId.slice(0, 16)} mono />
        )}
      </Box>
      {isOrphaned && (
        <Text textStyle="2xs" color="orange.fg" marginTop={1.5}>
          ⚠ Parent not in trace
        </Text>
      )}
    </Box>
  );

  return (
    <Tooltip content={tooltipContent} positioning={{ placement: "right" }}>
      <Box>
        <HStack
          height={`${rowH}px`}
          gap={0}
          paddingLeft={`${depth * INDENT_PX + 4}px`}
          paddingRight={2}
          bg={isSelected ? "blue.subtle" : isHovered ? "bg.muted" : undefined}
          opacity={isDimmed && !isSelected && !isHovered ? 0.5 : 1}
          _hover={{ bg: isSelected ? "blue.subtle" : "bg.muted" }}
          cursor="pointer"
          onClick={onSelect}
          onMouseEnter={onHoverStart}
          onMouseLeave={onHoverEnd}
          userSelect="none"
          flexShrink={0}
          transition="all 0.1s ease"
          borderLeftWidth={isSelected ? "2px" : "0px"}
          borderLeftColor={isSelected ? "blue.solid" : "transparent"}
        >
          {/* Chevron */}
          <Flex
            width="16px"
            height="16px"
            align="center"
            justify="center"
            flexShrink={0}
            onClick={(e) => {
              if (hasChildren) {
                e.stopPropagation();
                onToggleCollapse();
              }
            }}
            opacity={hasChildren ? 1 : 0}
            cursor={hasChildren ? "pointer" : "default"}
            borderRadius="xs"
            _hover={hasChildren ? { bg: "bg.emphasized" } : undefined}
          >
            <Icon
              as={isCollapsed ? LuChevronRight : LuChevronDown}
              boxSize={3}
              color="fg.muted"
            />
          </Flex>

          {/* Type icon */}
          <Flex
            width="18px"
            height="18px"
            align="center"
            justify="center"
            flexShrink={0}
            marginRight={1}
          >
            <Text
              textStyle="xs"
              color={isError ? "red.fg" : color}
              lineHeight={1}
              userSelect="none"
            >
              {icon}
            </Text>
          </Flex>

          {/* Orphaned indicator */}
          {isOrphaned && (
            <Tooltip
              content="Parent not in trace"
              positioning={{ placement: "top" }}
            >
              <Flex flexShrink={0} marginRight={1}>
                <Icon as={LuUnlink} boxSize={3} color="yellow.fg" />
              </Flex>
            </Tooltip>
          )}

          {/* Span name + metadata */}
          <Flex
            direction="column"
            flex={1}
            minWidth={0}
            gap={0}
            justify="center"
          >
            <HStack gap={1} minWidth={0}>
              <Text
                textStyle="xs"
                color={isError ? "red.fg" : "fg"}
                fontFamily="mono"
                truncate
                flex={1}
                minWidth={0}
                lineHeight={1.2}
              >
                {span.name}
              </Text>
              {signals.length > 0 && <LangwatchSignalBadges signals={signals} />}
            </HStack>
            {isLlm && (
              <Text
                textStyle="xs"
                color="fg.subtle"
                fontFamily="mono"
                truncate
                lineHeight={1.2}
              >
                {abbreviateModel(span.model!)}
              </Text>
            )}
          </Flex>

          {/* Error indicator */}
          {isError && (
            <Icon
              as={LuTriangleAlert}
              boxSize={3}
              color="red.fg"
              flexShrink={0}
              marginLeft={1}
            />
          )}

          {/* Duration */}
          <Text
            textStyle="xs"
            color="fg.muted"
            fontFamily="mono"
            flexShrink={0}
            marginLeft={1}
            whiteSpace="nowrap"
          >
            {isZeroDuration ? "<1ms" : formatDuration(duration)}
          </Text>
        </HStack>
      </Box>
    </Tooltip>
  );
}
