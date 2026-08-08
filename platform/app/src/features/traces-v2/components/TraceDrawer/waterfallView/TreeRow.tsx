import { Box, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { BookText, ScrollText } from "lucide-react";
import { memo, useCallback } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuPin,
  LuPinOff,
  LuRotateCcw,
  LuSparkles,
  LuTrash2,
  LuTriangleAlert,
} from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import type { LangwatchSignalBucket } from "~/server/api/routers/tracesV2.schemas";
import { useSpanHoverStore } from "../../../stores/spanHoverStore";
import { useSpanPulseStore } from "../../../stores/spanPulseStore";
import { formatCost, formatDuration } from "../../../utils/formatters";
import { AnchorCommentButton } from "../anchoredComments/AnchorCommentButton";
import { LangwatchSignalBadges } from "../LangwatchSignalBadges";
import { isSkillSpan } from "../transcript/skillInvocation";
import { TipCell } from "./TipCell";
import {
  getSpanPalette,
  INDENT_PX,
  isTwoLineSpan,
  LLM_ROW_HEIGHT,
  ROW_HEIGHT,
  SPAN_TYPE_ICONS,
  type WaterfallTreeNode,
} from "./types";

/** Shared empty list so a row with no comments keeps a stable prop identity. */
const NO_COMMENTS: AnnotationByTrace[] = [];

export const TreeRow = memo(function TreeRow({
  node,
  rootStart,
  rootDuration,
  isSelected,
  isPrompt,
  logCount,
  isPinned,
  isCollapsed,
  hasChildren,
  hiddenDescendantCount,
  isDimmed,
  signals,
  traceId,
  comments = NO_COMMENTS,
  isEditing = false,
  isDraftDeleted = false,
  isCorrected = false,
  isDeletedByCorrection = false,
  draftName,
  onToggleDelete,
  onToggleCollapse,
  onSelect,
  onTogglePin,
}: {
  node: WaterfallTreeNode;
  rootStart: number;
  rootDuration: number;
  isSelected: boolean;
  /** Whether this span carries a managed prompt (shows a book icon). */
  isPrompt: boolean;
  /**
   * Log records correlated to this span — a tool the user denied, an API
   * retry, a compaction — that never show up in the span's own input/output
   * because they only exist as logs. 0 hides the indicator.
   */
  logCount: number;
  /** Whether this span is currently pinned in the SpanTabBar. */
  isPinned: boolean;
  isCollapsed: boolean;
  hasChildren: boolean;
  /**
   * Number of descendants hidden by this row's collapse. Only non-zero
   * when `isCollapsed` — drives the "+N" count after the span name.
   */
  hiddenDescendantCount: number;
  isDimmed: boolean;
  signals: readonly LangwatchSignalBucket[];
  /**
   * The trace this row belongs to. Absent on a surface with no comments to
   * offer, which is what leaves the row's comment action off.
   */
  traceId?: string;
  /** What was said about this span, which the row's count opens onto. */
  comments?: AnnotationByTrace[];
  /** True while the reviewer is correcting this trace. */
  isEditing?: boolean;
  /** True when the correction removes this span (or an ancestor of it). */
  isDraftDeleted?: boolean;
  /** True when a stored correction changes this span. Tints the row green. */
  isCorrected?: boolean;
  /**
   * True when a stored correction removes this span and the reader is looking
   * at the captured trace, where it is still listed.
   */
  isDeletedByCorrection?: boolean;
  /**
   * The name an unsaved rename gives this span. The row reads with it while the
   * reviewer is editing, so a rename lands where they can see it instead of
   * only appearing once the correction is saved.
   */
  draftName?: string;
  /** Removes or brings back this span. Only wired while editing. */
  onToggleDelete?: (spanId: string) => void;
  onToggleCollapse: (spanId: string) => void;
  onSelect: (spanId: string) => void;
  /** Toggle pin state for this span — fired by the hover-revealed icon. */
  onTogglePin: (spanId: string) => void;
}) {
  const { span, depth } = node;
  // Hover highlight comes from a store with a per-row boolean selector
  // so a hover change re-renders only the two affected rows (this row
  // and its timeline twin), not every virtualized row on both panes.
  const isHovered = useSpanHoverStore((s) => s.hoveredSpanId === span.spanId);
  const setHoveredSpanId = useSpanHoverStore((s) => s.setHoveredSpanId);
  const handleMouseEnter = useCallback(
    () => setHoveredSpanId(span.spanId),
    [setHoveredSpanId, span.spanId],
  );
  const handleMouseLeave = useCallback(
    () => setHoveredSpanId(null),
    [setHoveredSpanId],
  );
  const handleClick = useCallback(
    () => onSelect(span.spanId),
    [onSelect, span.spanId],
  );
  // Subscribe just to *this* row's pulse state — the selector returns a
  // boolean so only the row whose pulse flips actually re-renders, the
  // rest of the virtualized list stays untouched.
  const isPulsing = useSpanPulseStore((s) => s.pulsingIds.has(span.spanId));
  // What the span is called right now: the pending rename while the reviewer is
  // editing, the captured name otherwise.
  const displayName = draftName ?? span.name;
  // A pending rename reads the same way a saved correction does, so an edit
  // looks like an edit before it is saved.
  const isEdited = isCorrected || draftName !== undefined;
  // Removal is the whole of the change for a span the correction deletes, and
  // the red marker is what says it. The green "changed" wash would only argue
  // with it, so it stays off those rows.
  const showsCorrectedTint = isEdited && !isDeletedByCorrection;
  const isError = span.status === "error";
  const isLlm = span.type === "llm" && span.model != null;
  // A named tool span gets the same two-line treatment as an LLM span: the
  // second line names WHICH tool ran (WebSearch, Read, Bash...), because a
  // wall of identical `claude_code.tool` rows was unreadable.
  const isNamedTool = !isLlm && span.toolName != null;
  // Same predicate the virtualizer's estimator uses — they must agree.
  const rowH = isTwoLineSpan(span) ? LLM_ROW_HEIGHT : ROW_HEIGHT;
  // A skill run (a `Skill` tool span) gets the sparkles glyph + purple chip so
  // it stands out from ordinary tool spans in the tree — the waterfall node
  // carries no input, so this flags the invocation without naming the skill
  // (the transcript card shows the slug). Mirrors the block-cost classifier's
  // skill_invocation category.
  const isSkill = isSkillSpan({ type: span.type, name: span.name });
  const TypeIcon = isSkill
    ? LuSparkles
    : (SPAN_TYPE_ICONS[span.type ?? "span"] ?? SPAN_TYPE_ICONS.span!);
  const palette = isSkill ? "purple" : getSpanPalette(span.type);
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
        {displayName}
      </Text>
      <HStack gap={1.5} marginTop={1} flexWrap="wrap">
        <Text
          textStyle="2xs"
          colorPalette={palette}
          color="colorPalette.fg"
          bg="colorPalette.subtle"
          paddingX={1.5}
          borderRadius="sm"
          borderWidth="1px"
          borderColor="colorPalette.muted"
          fontWeight="semibold"
        >
          {isSkill ? "SKILL" : (span.type ?? "span").toUpperCase()}
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
        {span.toolName && (
          <Text textStyle="2xs" color="fg.muted">
            {span.toolName}
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
        {isCollapsed && hiddenDescendantCount > 0 && (
          <TipCell label="Hidden spans" value={`${hiddenDescendantCount}`} />
        )}
        {logCount > 0 && (
          <TipCell label="Logs" value={`${logCount} — click to view`} />
        )}
        <TipCell label="Span ID" value={span.spanId.slice(0, 16)} mono />
        {/* Always rendered so the tooltip grid keeps a stable row count
            between spans — root spans show "none" instead of dropping
            the row, which made the grid jump while moving down the
            list. */}
        {span.parentSpanId ? (
          <TipCell label="Parent" value={span.parentSpanId.slice(0, 16)} mono />
        ) : (
          <TipCell label="Parent" value="none" isSubtle />
        )}
      </Box>
    </Box>
  );

  return (
    <Tooltip
      content={tooltipContent}
      positioning={{ placement: "right" }}
      // The default tooltip surface is inverted (dark in light mode), but
      // this rich tooltip's content uses panel-side tokens (`fg`,
      // `fg.muted`, palette badges) — render it on a panel surface so
      // every token resolves legibly in both colour modes.
      contentProps={{
        bg: "bg.panel",
        color: "fg",
        borderWidth: "1px",
        borderColor: "border",
        boxShadow: "md",
      }}
    >
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
          // Hover paints a faint wash of the span's own palette rather
          // than flat `bg.muted` — the full-width grey rectangle read as
          // an unloaded skeleton row in light mode. The /40 alpha keeps
          // it clearly a hover tint, not a fill.
          colorPalette={isError ? "red" : palette}
          bg={
            isSelected
              ? { base: "bg.emphasized", _dark: "blue.subtle" }
              : isHovered
                ? "colorPalette.subtle/40"
                : showsCorrectedTint
                  ? "green.subtle"
                  : undefined
          }
          // Edge tick on a corrected row so a change is spottable while
          // scanning the tree, not only once the row is read.
          boxShadow={
            showsCorrectedTint
              ? "inset 2px 0 0 var(--chakra-colors-green-solid)"
              : undefined
          }
          // Dark mode keeps the pre-PR behaviour of fading non-selected
          // rows when one is picked — the dark theme depends on that
          // contrast to keep the focus row "popping". Light mode stays
          // at full opacity (the neutral grey selection bg already
          // pulls the eye there without help).
          // A span the correction removes stays visible but reads as gone, so
          // the reviewer can see the shape of what they are cutting (and undo
          // it) rather than watching rows disappear one at a time.
          opacity={
            isDraftDeleted
              ? 0.45
              : {
                  base: 1,
                  _dark: isDimmed && !isSelected && !isHovered ? 0.4 : 1,
                }
          }
          _hover={{
            bg: isSelected
              ? { base: "bg.emphasized", _dark: "blue.subtle" }
              : "colorPalette.subtle/40",
          }}
          cursor="pointer"
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
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
                onToggleCollapse(span.spanId);
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
            <HStack gap={1} minWidth={0}>
              <Text
                textStyle="xs"
                color={isError ? "red.fg" : "fg"}
                textDecoration={isDraftDeleted ? "line-through" : undefined}
                truncate
                minWidth={0}
                lineHeight={1.2}
                // The badges beside it can squeeze the name down to a few
                // characters, so the name carries the whole of itself.
                title={displayName}
              >
                {displayName}
              </Text>
              {/* Book icon (the Prompts nav glyph) flags spans that used a
                  managed prompt, so prompt-bearing spans are spottable in
                  the tree without opening each one. */}
              {isPrompt && (
                <Icon
                  boxSize="11px"
                  color="purple.fg"
                  flexShrink={0}
                  aria-label="Uses a managed prompt"
                >
                  <BookText />
                </Icon>
              )}
              {/* Flags a span that has correlated log records — the ONLY
                  place a tool the user denied, a mid-run retry, or a
                  compaction shows up, since none of those produce a span
                  of their own. Generic: not scoped to any span type. */}
              {logCount > 0 && (
                <Icon
                  boxSize="11px"
                  color="cyan.fg"
                  flexShrink={0}
                  aria-label={`Has ${logCount} log ${logCount === 1 ? "record" : "records"}`}
                >
                  <ScrollText />
                </Icon>
              )}
              {/* The row's green wash and edge tick are colour, which a reader
                  who cannot separate the hues has nothing to read. The badge
                  says the same thing in words, the way the deleted one does. */}
              {showsCorrectedTint && (
                <Text
                  textStyle="2xs"
                  color="green.fg"
                  bg="green.subtle"
                  paddingX={1.5}
                  borderRadius="sm"
                  fontWeight="semibold"
                  flexShrink={0}
                  lineHeight={1.4}
                >
                  Edited
                </Text>
              )}
              {/* A span the stored correction removes is still listed while
                  the reader is on the captured trace, and the badge is what
                  tells them the corrected trace does not have it. */}
              {isDeletedByCorrection && (
                <Text
                  textStyle="2xs"
                  color="red.fg"
                  bg="red.subtle"
                  paddingX={1.5}
                  borderRadius="sm"
                  fontWeight="semibold"
                  flexShrink={0}
                  lineHeight={1.4}
                >
                  Deleted
                </Text>
              )}
              {/* Hidden-descendant count — a collapsed parent says how
                  much it's hiding, so plain collapse reads differently
                  from a GroupRow's "×N repeated" fold. */}
              {isCollapsed && hiddenDescendantCount > 0 && (
                <Text
                  textStyle="2xs"
                  color="fg.subtle"
                  flexShrink={0}
                  lineHeight={1.2}
                >
                  +{hiddenDescendantCount}
                </Text>
              )}
            </HStack>
            {(isLlm || isNamedTool) && (
              // Model / tool name as a compact pill (one per span) rather
              // than a bare text line — matches the header's Chip-based
              // Models pill idiom. The rich detail (full model name, token
              // breakdown, cost) lives in the row tooltip, which covers the
              // pill.
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
                  {isLlm ? span.model! : span.toolName}
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

          {/* Delete and restore, only while the trace is being corrected.
              Shown for a span the correction already removes so bringing it
              back never depends on finding the right row to hover. */}
          {isEditing && onToggleDelete && (
            <Tooltip
              content={isDraftDeleted ? "Restore span" : "Delete span"}
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
                color={isDraftDeleted ? "fg" : "red.fg"}
                opacity={isDraftDeleted || isHovered ? 1 : 0}
                pointerEvents={isDraftDeleted || isHovered ? "auto" : "none"}
                tabIndex={isDraftDeleted || isHovered ? 0 : -1}
                aria-hidden={!isDraftDeleted && !isHovered}
                _hover={{ bg: "bg.emphasized" }}
                _focusVisible={{ opacity: 1, bg: "bg.emphasized" }}
                transition="opacity 0.1s ease"
                cursor="pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleDelete(span.spanId);
                }}
                // Named after the span it acts on: every row carries one of
                // these, and "Delete span" on all of them tells a screen reader
                // user nothing about which one they are on.
                aria-label={
                  isDraftDeleted
                    ? `Restore span ${displayName}`
                    : `Delete span ${displayName}`
                }
              >
                <Icon
                  as={isDraftDeleted ? LuRotateCcw : LuTrash2}
                  boxSize={3}
                />
              </Flex>
            </Tooltip>
          )}

          {/* Comment on this span. Icon-only: the row has no width for a
              label, so the action names the span it acts on the way the row's
              delete already does. A span that carries comments shows the count
              at rest, because a comment nobody can see is a comment nobody
              reads. */}
          {traceId && (
            <AnchorCommentButton
              traceId={traceId}
              anchor={{ anchorKind: "span", anchorId: span.spanId }}
              comments={comments}
              name={displayName}
              dense
              reveal={isHovered ? "always" : "hidden"}
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
                onTogglePin(span.spanId);
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
});
