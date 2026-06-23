import {
  Box,
  chakra,
  Flex,
  HStack,
  Icon,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { memo, type RefObject, useCallback, useMemo } from "react";
import {
  LuChevronDown,
  LuCircleDashed,
  LuFlag,
  LuMessageCircle,
} from "react-icons/lu";
import { RedactedInline } from "~/components/ui/RedactedField";
import { Tooltip } from "~/components/ui/tooltip";
import {
  type ConversationTurn,
  useConversationContext,
} from "../../hooks/useConversationContext";
import { useTraceDrawerNavigation } from "../../hooks/useTraceDrawerNavigation";
import {
  getDrawerDensityTokens,
  useDensityStore,
} from "../../stores/densityStore";
import { useDrawerStore } from "../../stores/drawerStore";
import { formatPreview } from "../../utils/previewFormatter";
import { useDisplayRoleVisuals } from "./scenarioRoles";

interface ConversationContextProps {
  conversationId: string | null;
  traceId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /**
   * Optional ref the parent attaches so it can measure the natural
   * content height. PaneLayout uses this to cap the ctx Panel's
   * resizable range at the rows that actually exist (no "drag to
   * infinite empty band" behaviour).
   */
  contentRef?: RefObject<HTMLDivElement | null>;
  /**
   * Optional ref attached to the header button. PaneLayout reads
   * `offsetHeight` from this to set the collapsed Panel size pixel-
   * accurately — no trailing band between the chevron strip and the
   * viz tabs.
   */
  headerRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * Display row built from a turn — represents BOTH halves (user + assistant)
 * because a "turn" in chat is an exchange, not a single message. Earlier
 * versions rendered one row per side and missed the user-prompt half on
 * the current turn, which made the context strip read as half a
 * conversation. Now each slot shows both halves stacked: user on top,
 * assistant below.
 */
interface ConversationRow {
  key: string;
  traceId: string;
  /** Pre-extracted user prompt text, or null when there isn't one. */
  userText: string | null;
  /** Pre-extracted assistant response text, or null when there isn't one. */
  assistantText: string | null;
  /**
   * Per-side redaction: true when a privacy rule hid the content (server nulled
   * it), so the line renders the shared "Redacted" marker instead of the
   * "(no message)" placeholder that reads as a genuinely-absent turn.
   */
  userRedacted: boolean;
  assistantRedacted: boolean;
  userVisibleTo: string | null;
  assistantVisibleTo: string | null;
  /** "previous" / "current" / "next" relative to the visible trace */
  position: "previous" | "current" | "next";
  status: ConversationTurn["status"];
  /** True when the slot has no real turn — render as a "boundary" hint. */
  isPlaceholder?: boolean;
  /** Boundary kind for placeholders: "start" or "end" of conversation. */
  boundary?: "start" | "end";
}

const MAX_PREVIEW = 140;

// Hoisted so each render of ConversationContext doesn't re-allocate the
// variants object (and so `motion` doesn't see fresh references and
// re-evaluate variants resolution unnecessarily).
const SLIDE_VARIANTS: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1 },
  exit: { opacity: 0 },
};

// Quick tween instead of a spring — tested settle was 250-350ms with the
// spring config; a 160ms ease-out reads as much snappier without losing
// the bookshelf direction cue.
const SLIDE_TRANSITION = { duration: 0.16, ease: "easeOut" as const };

/**
 * Pull a readable snippet out of an input/output payload using the unified
 * `formatPreview` pipeline (JSON unwrap, fence/image strip, newline glyph,
 * cap). The `prefer` argument is a soft hint — when the payload is a chat
 * array, we walk it for the preferred role first and fall back to
 * `formatPreview` (which always returns the most-recent message of any
 * role) if there's no role match. For non-array payloads `formatPreview`
 * does all the work, so the strip's behaviour stays consistent across the
 * column / table / drawer surfaces.
 */
function extractReadableSnippet(
  raw: string | null | undefined,
  prefer: "user" | "assistant",
): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        for (let i = parsed.length - 1; i >= 0; i--) {
          const msg = parsed[i] as Record<string, unknown> | null;
          if (msg && msg.role === prefer) {
            const single = formatPreview(JSON.stringify([msg]), {
              maxChars: MAX_PREVIEW,
              newlines: "preserve",
            });
            if (single.text.trim()) return single.text;
          }
        }
      }
    } catch {
      /* fall through to formatPreview on raw input */
    }
  }
  return formatPreview(raw, {
    maxChars: MAX_PREVIEW,
    newlines: "preserve",
  }).text;
}

/**
 * Build the rows shown in the panel from the available turns.
 *
 * Reading flow we want is: previous user message → current assistant
 * response (highlighted) → next user message. Falls back to whatever side
 * is available when the other is missing.
 */
function buildRows({
  previous,
  current,
  next,
}: {
  previous: ConversationTurn | null;
  current: ConversationTurn | null;
  next: ConversationTurn | null;
}): ConversationRow[] {
  // Always returns exactly 3 rows so the section's height is stable. Missing
  // prev/next slots become "Start of conversation" / "End of conversation"
  // placeholders.
  const placeholder = (
    pos: "previous" | "next",
    boundary: "start" | "end",
  ): ConversationRow => ({
    key: `${pos}-placeholder`,
    traceId: "",
    userText: null,
    assistantText:
      boundary === "start" ? "Start of conversation" : "End of conversation",
    userRedacted: false,
    assistantRedacted: false,
    userVisibleTo: null,
    assistantVisibleTo: null,
    position: pos,
    status: "ok",
    isPlaceholder: true,
    boundary,
  });

  const buildSlot = (
    turn: ConversationTurn,
    position: "previous" | "current" | "next",
    keyPrefix: string,
  ): ConversationRow => ({
    key: `${keyPrefix}-${turn.traceId}`,
    traceId: turn.traceId,
    userText: extractReadableSnippet(turn.input, "user") || null,
    assistantText: extractReadableSnippet(turn.output, "assistant") || null,
    userRedacted: !!turn.inputRedacted,
    assistantRedacted: !!turn.outputRedacted,
    userVisibleTo: turn.inputVisibleTo ?? null,
    assistantVisibleTo: turn.outputVisibleTo ?? null,
    position,
    status: turn.status,
  });

  const prevRow = previous
    ? buildSlot(previous, "previous", "prev")
    : placeholder("previous", "start");
  const currRow = current ? buildSlot(current, "current", "curr") : null;
  const nextRow = next
    ? buildSlot(next, "next", "next")
    : placeholder("next", "end");

  return currRow ? [prevRow, currRow, nextRow] : [];
}

export const ConversationContext = memo(function ConversationContext({
  conversationId,
  traceId,
  collapsed,
  onToggleCollapsed,
  contentRef,
  headerRef,
}: ConversationContextProps) {
  const density = useDensityStore((s) => s.density);
  const densityTokens = getDrawerDensityTokens(density);
  const { navigateToTrace } = useTraceDrawerNavigation();
  const viewMode = useDrawerStore((s) => s.viewMode);
  const ctx = useConversationContext(conversationId, traceId);

  // Memo before the early `null` return so the hook order stays stable
  // when this component goes from "no conversation" → "conversation".
  const current = useMemo(
    () => ctx.turns.find((t) => t.traceId === traceId) ?? null,
    [ctx.turns, traceId],
  );
  // `buildRows` runs `extractReadableSnippet` up to 6 times — each one a
  // potential JSON parse on the input/output payload. Cache the result so
  // re-renders during the transition don't re-parse.
  const rows = useMemo(
    () => buildRows({ previous: ctx.previous, current, next: ctx.next }),
    [ctx.previous, current, ctx.next],
  );

  const navigate = useCallback(
    (id: string) => {
      if (id === traceId) return;
      const turn = ctx.turns.find((t) => t.traceId === id);
      navigateToTrace({
        fromTraceId: traceId,
        fromViewMode: viewMode,
        toTraceId: id,
        toTimestamp: turn?.timestamp,
      });
    },
    [traceId, ctx.turns, navigateToTrace, viewMode],
  );

  if (!conversationId) return null;
  // Single-turn conversation → render nothing at all (no header strip,
  // no "turn 1 of 1"). PaneLayout gates its ctx Panel slot on the same
  // `useConversationContext` query (cached, so both reads agree), which
  // prevents the historical "blank band between the Trace tabs and the
  // waterfall" failure mode when this returns null.
  if (!ctx.isLoading && ctx.total <= 1) return null;

  return (
    <Box
      // Drawer-spotlight anchor: only emitted for genuinely multi-turn
      // conversations so the show-once "Conversation context" spotlight
      // never fires while the thread count is still loading.
      {...(ctx.total > 1 ? { "data-spotlight": "conversation-context" } : {})}
      display="flex"
      flexDirection="column"
      height="100%"
      width="100%"
      minHeight={0}
      minWidth={0}
      // Light mode tone stack:
      //   panel bg     = `bg.surface` (white) — header + content both
      //                  sit on white, matching the accordion sections
      //   row borders  = `gray.200` (light only)
      //   non-selected = `bg.surface` (white)
      //   selected     = `blue.subtle` — matches the row-selection blue
      //                  used on the trace list, replacing the previous
      //                  gray indent
      // Dark mode keeps the validated palette.
      bg={{ base: "bg.surface", _dark: "bg.surface" }}
      // Bottom border doubles as the ctx ↔ viz separator when the
      // pane is expanded (the header's own borderBottom only sits at
      // the chevron line, not at the bottom of the pane).
      borderBottomWidth="1px"
      borderColor={{ base: "gray.200", _dark: "border.muted" }}
    >
      <ContextHeader
        position={ctx.position}
        total={ctx.total}
        isLoading={ctx.isLoading}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        densityPaddingY={densityTokens.sectionTriggerY}
        buttonRef={headerRef}
      />
      {collapsed ? null : (
        // Two-level structure on purpose:
        //   - outer Box `flex={1} overflow="auto"` — the scroll
        //     container, fills the Panel's remaining space
        //   - inner Box `ref={contentRef}` — naturally sized
        //     (no flex, no overflow), so its `scrollHeight` /
        //     `offsetHeight` always equals the row content's actual
        //     height regardless of how tall the Panel gets
        // Without the split, `scrollHeight` on an overflow:auto
        // element clamps to `>= clientHeight` — dragging the Panel
        // bigger made the measured "content height" grow with it,
        // ctxMaxSize grew with it, and the drag had no real cap
        // (visible as the slow-drag with infinite trailing whitespace).
        <Box flex={1} minHeight={0} overflow="auto" paddingX={4} paddingY={3}>
          <Box ref={contentRef}>
            <ContextBody
              ctx={ctx}
              rows={rows}
              traceId={traceId}
              onSelect={navigate}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
});

/**
 * Header matching the Section/Input-Output accordion style used
 * elsewhere in the drawer: white bg, muted uppercase title, chevron
 * on the right (not the left). Double-click the header to toggle
 * collapsed state — same affordance the Pane primitive used to
 * expose.
 */
function ContextHeader({
  position,
  total,
  isLoading,
  collapsed,
  onToggleCollapsed,
  densityPaddingY,
  buttonRef,
}: {
  position: number;
  total: number;
  isLoading: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Chakra spacing unit matching AccordionShell's section triggers. */
  densityPaddingY: number;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <chakra.button
      ref={buttonRef}
      type="button"
      onClick={onToggleCollapsed}
      aria-expanded={!collapsed}
      display="flex"
      alignItems="center"
      gap={2}
      width="100%"
      paddingX={4}
      // Match the accordion section triggers below so all the strips in
      // the drawer body share one rhythm. The accordion's `<HStack>` row
      // adds a touch more visual height than `chakra.button` alone, so
      // we bump paddingY by half a density step to keep the visible
      // strip on the same beat.
      paddingY={densityPaddingY + 0.5}
      bg="bg.surface"
      borderTopWidth="0"
      borderBottomWidth="1px"
      borderColor={{ base: "gray.200", _dark: "border.muted" }}
      color="fg.muted"
      cursor="pointer"
      textAlign="left"
      transition="background 120ms ease, color 120ms ease"
      _hover={{ bg: "bg.softHover", color: "fg" }}
      flexShrink={0}
    >
      <Icon as={LuMessageCircle} boxSize={3} color="inherit" />
      <Text
        textStyle="2xs"
        fontWeight="semibold"
        color="inherit"
        textTransform="uppercase"
        letterSpacing="wider"
      >
        Conversation Context
      </Text>
      {isLoading ? (
        <Text textStyle="2xs" color="fg.subtle">
          loading…
        </Text>
      ) : total > 0 ? (
        <Text textStyle="2xs" color="fg.subtle">
          turn {position} of {total}
        </Text>
      ) : null}
      <Box flex={1} />
      <Icon
        as={LuChevronDown}
        boxSize={3}
        color="inherit"
        transition="transform 120ms ease"
        // Collapsed = chevron points down (closed); expanded = points
        // up (rotated 180). Matches the accordion sections below.
        transform={collapsed ? "rotate(0deg)" : "rotate(180deg)"}
      />
    </chakra.button>
  );
}

function ContextBody({
  ctx,
  rows,
  traceId,
  onSelect,
}: {
  ctx: ReturnType<typeof useConversationContext>;
  rows: ConversationRow[];
  traceId: string;
  onSelect: (id: string) => void;
}) {
  // Turns folded out of the previous/current/next window: anything before
  // the "previous" row (position − 2) or after the "next" row
  // (total − position − 1). Zero at a boundary, where the
  // "Start/End of conversation" placeholder row covers it instead. See
  // specs/traces-v2/conversation-context-turn-counts.feature
  const turnsAbove = Math.max(0, ctx.position - 2);
  const turnsBelow = Math.max(0, ctx.total - ctx.position - 1);
  return (
    <>
      {ctx.isLoading && rows.length === 0 ? (
        // Skeleton mirrors the eventual row layout (icon + line) so the
        // section doesn't jump in height once the thread resolves.
        <VStack
          align="stretch"
          gap={0}
          borderRadius="md"
          borderWidth="1px"
          borderColor="border.muted"
          bg="bg.panel"
          overflow="hidden"
        >
          {[0, 1, 2].map((i) => (
            <HStack
              key={i}
              paddingX={3}
              paddingY={2}
              gap={2.5}
              borderBottomWidth={i === 2 ? 0 : "1px"}
              borderColor={{ base: "gray.200", _dark: "border.muted" }}
            >
              <Skeleton height="14px" width="56px" borderRadius="sm" />
              <Skeleton height="14px" width="14px" borderRadius="full" />
              <Skeleton
                height="12px"
                flex={1}
                borderRadius="sm"
                opacity={i === 1 ? 1 : 0.55}
              />
            </HStack>
          ))}
        </VStack>
      ) : rows.length === 0 ? (
        <Box
          paddingY={3}
          paddingX={3}
          borderRadius="md"
          borderWidth="1px"
          borderColor={{ base: "gray.200", _dark: "border.muted" }}
          bg="bg.panel"
        >
          <Text textStyle="2xs" color="fg.subtle">
            This is the only turn in the conversation.
          </Text>
        </Box>
      ) : (
        // Bookshelf slide on navigation: the whole 3-row strip slides up
        // (J / forward) or down (K / backward), exiting one strip while the
        // new one slides in from the opposite side. Same snappy spring as
        // the body bookshelf.
        <Box
          position="relative"
          borderRadius="md"
          borderWidth="1px"
          // Light mode uses a deeper gray than `border.muted` so the
          // card frame reads against the white panel surface. Dark
          // mode keeps the validated muted border.
          borderColor={{ base: "gray.200", _dark: "border.muted" }}
          bg="bg.panel"
          overflow="hidden"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={traceId}
              variants={SLIDE_VARIANTS}
              initial="enter"
              animate="center"
              exit="exit"
              transition={SLIDE_TRANSITION}
            >
              <VStack align="stretch" gap={0}>
                {turnsAbove > 0 && (
                  <Text
                    textStyle="2xs"
                    color="fg.subtle"
                    textAlign="center"
                    paddingY={1}
                    borderBottomWidth="1px"
                    borderColor={{ base: "gray.200", _dark: "border.muted" }}
                  >
                    {turnsAbove} {turnsAbove === 1 ? "turn" : "turns"} above
                  </Text>
                )}
                {rows.map((row, i) => (
                  <ConversationRow
                    key={row.key}
                    row={row}
                    isLast={i === rows.length - 1 && turnsBelow === 0}
                    onSelect={onSelect}
                  />
                ))}
                {turnsBelow > 0 && (
                  <Text
                    textStyle="2xs"
                    color="fg.subtle"
                    textAlign="center"
                    paddingY={1}
                    borderTopWidth="1px"
                    borderColor={{ base: "gray.200", _dark: "border.muted" }}
                  >
                    {turnsBelow} {turnsBelow === 1 ? "turn" : "turns"} below
                  </Text>
                )}
              </VStack>
            </motion.div>
          </AnimatePresence>
        </Box>
      )}
    </>
  );
}

const ConversationRow = memo(function ConversationRow({
  row,
  isLast,
  onSelect,
}: {
  row: ConversationRow;
  isLast: boolean;
  /** Stable callback from the parent — the row decides if it fires. */
  onSelect: (traceId: string) => void;
}) {
  const isCurrent = row.position === "current";
  const isPlaceholder = !!row.isPlaceholder;
  const handleClick = useCallback(() => {
    if (isPlaceholder || isCurrent) return;
    onSelect(row.traceId);
  }, [isPlaceholder, isCurrent, onSelect, row.traceId]);
  // Visuals for both halves of a turn — user on top, assistant below.
  const userVisuals = useDisplayRoleVisuals("user");
  const assistantVisuals = useDisplayRoleVisuals("assistant");

  if (isPlaceholder) {
    const PlaceholderIcon = row.boundary === "start" ? LuFlag : LuCircleDashed;
    return (
      <Flex
        align="center"
        gap={2.5}
        paddingX={3}
        paddingY={2}
        borderBottomWidth={isLast ? 0 : "1px"}
        // Border color must not be inside the opacity-dimmed scope —
        // otherwise the separator between the "Start of conversation"
        // placeholder and the selected blue row reads as a barely-
        // visible line. Use the same `gray.200` border the rest of
        // the rows do, at full opacity, while the rest of the
        // placeholder visuals stay dimmed via a child opacity wrapper.
        borderColor={{ base: "gray.200", _dark: "border.muted" }}
        cursor="default"
      >
        <Flex align="center" gap={2.5} flex={1} minWidth={0} opacity={0.55}>
          <Icon
            as={PlaceholderIcon}
            boxSize={3.5}
            color="fg.subtle"
            flexShrink={0}
          />
          <Text
            textStyle="xs"
            color="fg.subtle"
            fontStyle="italic"
            truncate
            flex={1}
            minWidth={0}
          >
            {row.assistantText ?? row.userText ?? ""}
          </Text>
        </Flex>
      </Flex>
    );
  }

  return (
    <Tooltip
      content={`View the trace of the ${row.position} turn in the conversation`}
      disabled={row.position === "current"}
    >
      <Flex
        as={isCurrent ? "div" : "button"}
        align="stretch"
        gap={2.5}
        paddingX={3}
        paddingY={2}
        // Selected row uses `blue.subtle` in both modes — same tint
        // the trace list applies to the active row, so the operator's
        // "this is the current turn" cue is consistent across
        // surfaces. Non-selected rows are white (light) / transparent
        // (dark) so the panel chrome shows through.
        bg={
          isCurrent
            ? "blue.subtle"
            : { base: "bg.surface", _dark: "transparent" }
        }
        borderBottomWidth={isLast ? 0 : "1px"}
        borderColor={{ base: "gray.200", _dark: "border.muted" }}
        cursor={isCurrent ? "default" : "pointer"}
        onClick={isCurrent ? undefined : handleClick}
        _hover={
          isCurrent ? undefined : { bg: { base: "gray.50", _dark: "bg.muted" } }
        }
        transition="background 0.12s ease"
        textAlign="left"
        width="full"
        css={
          isCurrent
            ? {
                animation: "tracesV2CurrentRowPulse 0.6s ease-out",
                "@keyframes tracesV2CurrentRowPulse": {
                  "0%": {
                    backgroundColor:
                      "color-mix(in srgb, var(--chakra-colors-blue-500) 18%, transparent)",
                    boxShadow:
                      "inset 0 0 0 1px color-mix(in srgb, var(--chakra-colors-blue-500) 25%, transparent)",
                  },
                  "100%": {
                    backgroundColor: "transparent",
                    boxShadow: "inset 0 0 0 1px transparent",
                  },
                },
                "@media (prefers-reduced-motion: reduce)": {
                  animation: "none",
                },
              }
            : undefined
        }
      >
        <VStack align="stretch" gap={1.5} flex={1} minWidth={0}>
          <TurnLine
            icon={userVisuals.Icon}
            // Input / user side = blue. Matches the IOPreview's INPUT
            // label and the up-arrow chip used on the trace list rows
            // (lighter than `blue.fg` so the icon doesn't shout).
            iconColor={{ base: "blue.500", _dark: "blue.fg" }}
            text={row.userText}
            // No bold on the input line of the current turn —
            // selection is communicated by the row's blue.subtle bg,
            // not by font weight (operator feedback).
            emphasised={false}
            placeholder="(no user message)"
            kind="user"
            redacted={row.userRedacted}
            visibleTo={row.userVisibleTo}
          />
          <TurnLine
            icon={assistantVisuals.Icon}
            // Output / assistant side = green. Matches the IOPreview's
            // OUTPUT label and the down-arrow chip on the trace list.
            iconColor={{ base: "green.solid", _dark: "green.fg" }}
            text={row.assistantText}
            emphasised={isCurrent}
            placeholder="(no assistant response)"
            kind="assistant"
            redacted={row.assistantRedacted}
            visibleTo={row.assistantVisibleTo}
          />
        </VStack>
      </Flex>
    </Tooltip>
  );
});

/**
 * Single line in a turn slot — either user or assistant half. The two
 * lines are visually distinct in three ways so the eye can parse a turn
 * at a glance:
 *
 *   1. The user line keeps the slot's background; the assistant line gets
 *      a subtle `bg.muted` tint that marks it as the reply card within
 *      the turn. One bar, two backgrounds — same idea you'd find in
 *      message threads (quoted reply on a tinted strip).
 *   2. The assistant line is indented and prefixed with a `↳` reply
 *      glyph so the hierarchy reads "this is the response to that".
 *   3. Icon colours differ per role: user = `fg` (full neutral), assistant
 *      = `blue.fg`. The reply text itself stays muted regardless of
 *      whether the slot is current, so the user prompt always reads as
 *      the louder of the two — which matches how people scan a chat
 *      ("what was asked, then what was answered").
 *
 * The `↳` glyph is `aria-hidden` because the user/bot icon already names
 * the role for assistive tech.
 */
const TurnLine: React.FC<{
  icon: React.ElementType;
  iconColor: string | Record<string, string>;
  text: string | null;
  emphasised: boolean;
  placeholder: string;
  kind: "user" | "assistant";
  /**
   * True when a privacy rule hid this side's content. Renders the shared
   * "Redacted" marker in place of the snippet / "(no message)" placeholder, so
   * a hidden turn never reads as a genuinely-empty one.
   */
  redacted?: boolean;
  visibleTo?: string | null;
}> = ({
  icon,
  iconColor,
  text,
  emphasised,
  placeholder,
  kind,
  redacted = false,
  visibleTo = null,
}) => {
  const isAssistant = kind === "assistant";
  return (
    <HStack
      gap={1.5}
      align="flex-start"
      paddingY={1}
      paddingX={isAssistant ? 2 : 1}
      paddingLeft={isAssistant ? 5 : 1}
      borderRadius="sm"
      position="relative"
    >
      {isAssistant && (
        <Text
          as="span"
          aria-hidden
          color="fg.subtle"
          textStyle="xs"
          position="absolute"
          left={1.5}
          // Align with the first text line, not the bubble's vertical
          // midpoint — multi-line replies otherwise pushed the glyph
          // way below where it visually belongs ("↳ reply" is a
          // first-line affordance, not a side decoration).
          top="6px"
        >
          ↳
        </Text>
      )}
      <Icon
        as={icon}
        boxSize={3.5}
        color={iconColor}
        flexShrink={0}
        // ~2px down so the icon's vertical center lines up with the
        // first text line's center, not with the top edge — `boxSize`
        // 3.5 (14px) inside `textStyle="xs"` (12px / 18px line) needs
        // (18-14)/2 = 2px of nudge.
        marginTop="2px"
      />
      {redacted && !text ? (
        // Content hidden by a privacy rule — the shared lock + "Redacted"
        // marker, not the "(no message)" placeholder, so a hidden line is never
        // mistaken for a genuinely-empty one.
        <Box flex={1} minWidth={0}>
          <RedactedInline visibleTo={visibleTo} size="xs" />
        </Box>
      ) : (
        <Text
          textStyle="xs"
          color={
            text
              ? isAssistant
                ? "fg.muted"
                : emphasised
                  ? "fg"
                  : "fg.muted"
              : "fg.subtle"
          }
          fontStyle={text ? "normal" : "italic"}
          fontWeight={emphasised && text && !isAssistant ? "medium" : "normal"}
          flex={1}
          minWidth={0}
          // Real line breaks instead of the previous "↵" inline glyph —
          // the snippet is short enough that letting it wrap to a couple
          // of extra lines reads better than collapsing multiple lines
          // into a single one with arrow runes.
          whiteSpace="pre-wrap"
          wordBreak="break-word"
        >
          {text ?? placeholder}
        </Text>
      )}
    </HStack>
  );
};
