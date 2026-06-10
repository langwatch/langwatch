import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import {
  LuChevronDown,
  LuChevronRight,
  LuPin,
  LuPinOff,
  LuTriangleAlert,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { LangwatchSignalBucket } from "~/server/api/routers/tracesV2.schemas";
import { useSpanPulseStore } from "../../../stores/spanPulseStore";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  SPAN_TYPE_COLORS,
} from "../../../utils/formatters";
import { LangwatchSignalBadges } from "../LangwatchSignalBadges";
import { TipCell } from "./TipCell";
import {
  getSpanPalette,
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
  isPinned,
  isCollapsed,
  hasChildren,
  isDimmed,
  signals,
  onToggleCollapse,
  onSelect,
  onTogglePin,
  onHoverStart,
  onHoverEnd,
}: {
  node: WaterfallTreeNode;
  rootStart: number;
  rootDuration: number;
  isSelected: boolean;
  isHovered: boolean;
  /** Whether this span is currently pinned in the SpanTabBar. */
  isPinned: boolean;
  isCollapsed: boolean;
  hasChildren: boolean;
  isDimmed: boolean;
  signals: readonly LangwatchSignalBucket[];
  onToggleCollapse: () => void;
  onSelect: () => void;
  /** Toggle pin state for this span — fired by the hover-revealed icon. */
  onTogglePin: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  const { span, depth } = node;
  // Subscribe just to *this* row's pulse state — the selector returns a
  // boolean so only the row whose pulse flips actually re-renders, the
  // rest of the virtualized list stays untouched.
  const isPulsing = useSpanPulseStore((s) => s.pulsingIds.has(span.spanId));
  const isError = span.status === "error";
  const color =
    (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
  const isLlm = span.type === "llm" && span.model != null;
  const rowH = isLlm ? LLM_ROW_HEIGHT : ROW_HEIGHT;
  const TypeIcon =
    SPAN_TYPE_ICONS[span.type ?? "span"] ?? SPAN_TYPE_ICONS.span!;
  const palette = getSpanPalette(span.type);
  const duration = span.durationMs;
  const isZeroDuration = duration === 0;
  const offsetMs = Math.max(0, span.startTimeMs - rootStart);
  const sharePct =
    rootDuration > 0 ? Math.round((duration / rootDuration) * 100) : 0;
  const totalTokens =
    (span.inputTokens ?? 0) +
    (span.outputTokens ?? 0) +
    (span.cacheReadTokens ?? 0) +
    (span.cacheCreationTokens ?? 0);

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
          <Text textStyle="2xs" color="fg.muted">
            {span.model}
          </Text>
        )}
      </HStack>
      {/* Token breakdown — same rows the header Tokens pill shows on
          hover, scoped to this span. Only rendered when the span
          actually reported usage — or a cost, so spans with an explicit
          cost but no token counts still surface it in the tooltip. */}
      {(totalTokens > 0 || (span.cost ?? 0) > 0) && (
        <Box
          marginTop={1.5}
          display="grid"
          gridTemplateColumns="auto 1fr"
          gap={0.5}
          columnGap={3}
        >
          {span.inputTokens != null && (
            <TipCell label="Input" value={span.inputTokens.toLocaleString()} />
          )}
          {span.outputTokens != null && (
            <TipCell
              label="Output"
              value={span.outputTokens.toLocaleString()}
            />
          )}
          {span.cacheReadTokens != null && (
            <TipCell
              label="Cache read"
              value={span.cacheReadTokens.toLocaleString()}
            />
          )}
          {span.cacheCreationTokens != null && (
            <TipCell
              label="Cache write"
              value={span.cacheCreationTokens.toLocaleString()}
            />
          )}
          {totalTokens > 0 && (
            <TipCell label="Total" value={totalTokens.toLocaleString()} />
          )}
          {span.cost != null && span.cost > 0 && (
            <TipCell label="Cost" value={formatCost(span.cost)} />
          )}
        </Box>
      )}
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
    </Box>
  );

  return (
    <Tooltip content={tooltipContent} positioning={{ placement: "right" }}>
      <Box position="relative">
        {/* Pulse layer: a one-shot orange wash that fades over 1.2s when
            a new span arrives via SSE. Sits absolutely above the row's
            existing background so selection / hover state continues to
            show through underneath as the pulse fades out. Pointer
            events off so the click target on the row stays the row. */}
        {isPulsing && (
          <Box
            position="absolute"
            inset={0}
            pointerEvents="none"
            zIndex={1}
            css={{
              animation: "lw-span-pulse 1.2s ease-out forwards",
              "@keyframes lw-span-pulse": {
                "0%": {
                  backgroundColor: "var(--chakra-colors-orange-subtle)",
                  boxShadow: "inset 2px 0 0 var(--chakra-colors-orange-solid)",
                },
                "100%": {
                  backgroundColor: "transparent",
                  boxShadow: "inset 2px 0 0 transparent",
                },
              },
              "@media (prefers-reduced-motion: reduce)": {
                animation: "none",
                backgroundColor: "transparent",
              },
            }}
          />
        )}
        <HStack
          height={`${rowH}px`}
          gap={0}
          paddingLeft={`${depth * INDENT_PX + 4}px`}
          paddingRight={2}
          // Light mode picks up a neutral grey for selection (`bg.emphasized`)
          // rather than a blue tint — keeps the row visually distinct from
          // the hover state without competing with the bar's own colour.
          // Dark mode keeps the existing blue tint, which reads well against
          // the dark panel.
          bg={
            isSelected
              ? { base: "bg.emphasized", _dark: "blue.subtle" }
              : isHovered
                ? "bg.muted"
                : undefined
          }
          // Dark mode keeps the pre-PR behaviour of fading non-selected
          // rows when one is picked — the dark theme depends on that
          // contrast to keep the focus row "popping". Light mode stays
          // at full opacity (the neutral grey selection bg already
          // pulls the eye there without help).
          opacity={{
            base: 1,
            _dark: isDimmed && !isSelected && !isHovered ? 0.4 : 1,
          }}
          _hover={{
            bg: isSelected
              ? { base: "bg.emphasized", _dark: "blue.subtle" }
              : "bg.muted",
          }}
          cursor="pointer"
          onClick={onSelect}
          onMouseEnter={onHoverStart}
          onMouseLeave={onHoverEnd}
          flexShrink={0}
          transition="all 0.1s ease"
          borderLeftWidth={isSelected ? "2px" : "0px"}
          borderLeftColor={
            isSelected
              ? { base: "fg.muted", _dark: "blue.solid" }
              : "transparent"
          }
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

          {/* Type icon — rendered inside a colored chip so the span type
              reads at a glance even before the row text. Uses
              `colorPalette` (a Chakra v3 token-resolution scope) instead
              of interpolating the palette into the token string —
              `${palette}.subtle` would resolve OK in light mode but the
              dark-mode variant for some palettes (esp. blue/purple at
              `.subtle`) gave near-invisible icon-on-bg contrast. The
              `colorPalette.subtle` / `colorPalette.fg` aliases pick the
              right pair for the active colour mode automatically. */}
          <Flex
            width="18px"
            height="18px"
            align="center"
            justify="center"
            flexShrink={0}
            marginRight={1.5}
            borderRadius="sm"
            colorPalette={isError ? "red" : palette}
            bg="colorPalette.subtle"
            color="colorPalette.fg"
          >
            <Icon as={TypeIcon} boxSize={3} />
          </Flex>

          {/* Span name + metadata */}
          <Flex
            direction="column"
            flex={1}
            minWidth={0}
            gap={0}
            justify="center"
          >
            <Text
              textStyle="xs"
              color={isError ? "red.fg" : "fg"}
              truncate
              minWidth={0}
              lineHeight={1.2}
            >
              {span.name}
            </Text>
            {isLlm && (
              // Model as a compact pill (one per span) rather than a bare
              // text line — matches the header's Chip-based Models pill
              // idiom. The rich detail (full model name, token breakdown,
              // cost) lives in the row tooltip, which covers the pill.
              <HStack gap={1} marginTop="1px">
                <Text
                  textStyle="2xs"
                  color="fg.muted"
                  borderWidth="1px"
                  borderColor="border.muted"
                  borderRadius="full"
                  paddingX={1.5}
                  lineHeight={1.4}
                  truncate
                  maxWidth="100%"
                  bg="bg.subtle"
                >
                  {abbreviateModel(span.model!)}
                </Text>
              </HStack>
            )}
          </Flex>

          {/* Signal badges — sit on the row, not inside the name column,
              so they vertically center against the full row height
              instead of clinging to the top line on two-line LLM rows. */}
          {signals.length > 0 && (
            <Flex
              align="center"
              flexShrink={0}
              marginLeft={1}
              alignSelf="center"
            >
              <LangwatchSignalBadges signals={signals} />
            </Flex>
          )}

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

          {/* Pin toggle — hover-revealed on the row (or always shown when
              the span is already pinned, so the affordance for unpinning
              is discoverable without having to hover the right span).
              Click toggles `pinSpan`/`unpinSpan` on the drawer store
              without selecting the row, so the user can build up a set
              of tabs without flipping the span detail every time. */}
          <Tooltip
            content={isPinned ? "Unpin span tab" : "Pin span tab"}
            positioning={{ placement: "top" }}
            openDelay={400}
          >
            <Flex
              as="button"
              width="20px"
              height="20px"
              align="center"
              justify="center"
              flexShrink={0}
              marginLeft={1}
              borderRadius="xs"
              color={isPinned ? "fg" : "fg.subtle"}
              opacity={isPinned || isHovered ? 1 : 0}
              // Make the button unfocusable + non-interactive while it's
              // visually hidden. Without this, keyboard users tab onto
              // an invisible control and the row's navigation flow
              // breaks (the focus lands somewhere with no visible
              // target). The hover-revealed pin re-enters tab order
              // automatically once the row is hovered or already
              // pinned.
              pointerEvents={isPinned || isHovered ? "auto" : "none"}
              tabIndex={isPinned || isHovered ? 0 : -1}
              aria-hidden={!isPinned && !isHovered}
              _hover={{ bg: "bg.emphasized", color: "fg" }}
              _focusVisible={{
                opacity: 1,
                bg: "bg.emphasized",
                color: "fg",
              }}
              transition="opacity 0.1s ease, color 0.1s ease"
              cursor="pointer"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              aria-label={isPinned ? "Unpin span tab" : "Pin span tab"}
              aria-pressed={isPinned}
            >
              <Icon as={isPinned ? LuPinOff : LuPin} boxSize={3} />
            </Flex>
          </Tooltip>

          {/* Cost + duration render as fixed-width right-aligned columns
              (tabular numerals) so every row's trailing figures line up
              vertically — variable-width text here made the whole right
              edge of the list read as ragged. The cost slot is always
              present (empty for spans without one) so the duration
              column can't drift between LLM and non-LLM rows. */}
          <Text
            textStyle="xs"
            color="fg.muted"
            flexShrink={0}
            marginLeft={2}
            minWidth="52px"
            textAlign="right"
            whiteSpace="nowrap"
            fontVariantNumeric="tabular-nums"
          >
            {span.cost != null && span.cost > 0 ? formatCost(span.cost) : ""}
          </Text>

          <Text
            textStyle="xs"
            color="fg.muted"
            flexShrink={0}
            marginLeft={2}
            minWidth="52px"
            textAlign="right"
            whiteSpace="nowrap"
            fontVariantNumeric="tabular-nums"
          >
            {isZeroDuration ? "<1ms" : formatDuration(duration)}
          </Text>
        </HStack>
      </Box>
    </Tooltip>
  );
}
