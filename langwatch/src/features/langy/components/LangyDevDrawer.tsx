/**
 * Developer mode's inspector — a drawer that slides out of the LEFT edge of the
 * Langy panel.
 *
 * Developer mode used to be a scatter: a "show raw JSON" toggle on each tool
 * card, some extra fields on error cards, and a hidden card gallery. Useful, but
 * only where someone had thought to add an expander, and never for the questions
 * that actually come up — did the server send anything? in what order? what does
 * the client believe right now? So the mode grows a place of its own, beside the
 * conversation rather than inside it. The three wire views PARTITION the tape —
 * every entry appears in exactly one of them, so no kind is invisible — and they
 * run in pipeline order, which makes finding the stage that lost something a
 * left-to-right read:
 *
 *   TOKENS   the answer as it arrives, straight off the wire, with the
 *            rendering pipeline taken out of the picture. When the panel shows
 *            different prose from what was streamed, this is the arbiter.
 *   EPHEMERAL the signals that never become message parts — status, progress,
 *            milestones, reasoning, plan snapshots, the terminal frame. They
 *            fork into the store, drive the thinking line and the fold, and are
 *            then gone; nothing persists them, which is what makes them the
 *            hardest part of a turn to debug. Including the ones the transport
 *            swallows, because "the UI showed nothing" and "the server sent
 *            nothing" are different bugs.
 *   EVENTS   tool calls, each FOLDED from its two wire entries (input, output,
 *            error, duration) and shown WITH the card it produced — kind,
 *            surface, tone, body widget. Cards are not on the wire; there is no
 *            "card event". They are derived here by `resolveCliCapability`, so
 *            a call that renders as a plain activity line instead of the rich
 *            card you expected is only visible as such here.
 *   STORE    the client's live belief: turn phase, ids, in-flight signals,
 *            the panel's own flags. Most Langy UI bugs are a disagreement
 *            between this and the tape above, and the fastest way to see one is
 *            to put them on the same screen.
 *
 * IT LIVES OUTSIDE THE PANEL, on purpose. The panel sets `overflow: hidden` (it
 * owns its own scrolling surface and has to clip the fold), so a child sliding
 * left would simply be cut off at the edge. The drawer is therefore a fixed
 * sibling, offset by the panel's own width so the two edges meet, and it mirrors
 * the panel's geometry per layout — bottom-anchored card when floating,
 * full-height when docked.
 */
import {
  Box,
  chakra,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Eraser, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import {
  APP_HEADER_HEIGHT,
  FLOATING_PANEL_CSS_WIDTH,
  SIDEBAR_PANEL_WIDTH,
} from "../logic/langyPanelLayout";
import { resolveCliCapability } from "./capabilities/capabilityRegistry";
import {
  DEV_LOG_CAPACITY,
  type DevToolCall,
  entryKindCounts,
  type LangyDevLogRecord,
  recordKind,
  recordSummary,
  replayTurnProjection,
  streamRecords,
  tapeUpTo,
  tokenStreamText,
  toolCallsFrom,
  useLangyDevLog,
} from "../stores/langyDevLog";
import { useLangyStore } from "../stores/langyStore";

const MotionBox = motion.create(Box);

/** Matches the panel's own symmetric viewport inset in floating mode. */
const PANEL_INSET = 12;
const DRAWER_WIDTH = 380;

/**
 * How far the drawer slides UNDER the panel's left edge.
 *
 * Butted up exactly against the panel, the drawer's own rounded right corners
 * stayed visible as two little notches against the panel's straight edge — the
 * pair read as two cards that happened to be touching. Tucking it a few pixels
 * behind (the panel sits at a higher z-index and paints over it) buries the
 * radius, so the drawer reads as something the panel pulled out of itself.
 */
const DRAWER_TUCK = 10;

type DevTab = "log" | "tokens" | "ephemeral" | "events" | "store";

// LOG is the whole tape, every lane interleaved in arrival order — outbound
// commands, the inbound stream, the durable event log, the freshness signals —
// because "in what order, across channels?" is the question the partitioned
// views cannot answer. The three wire views then PARTITION the stream lane —
// deltas, signals, tool calls — so every stream entry is visible in exactly
// one of them. Store is the client's own belief, which is what you compare
// them all against.
const TABS: { id: DevTab; label: string }[] = [
  { id: "log", label: "Log" },
  { id: "tokens", label: "Tokens" },
  { id: "ephemeral", label: "Ephemeral" },
  { id: "events", label: "Events" },
  { id: "store", label: "Store" },
];

export function LangyDevDrawer({
  open,
  onClose,
  floating,
}: {
  open: boolean;
  onClose: () => void;
  /** Mirror the panel's layout, so the two always share an edge. */
  floating: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<DevTab>("log");

  // Recording is armed by the drawer being OPEN, and only then: with it shut,
  // `record()` is a boolean check per wire entry and nothing is retained. This
  // also means the tape starts where you started looking, which is almost
  // always what you want — open it, send a turn, read what happened.
  const setRecording = useLangyDevLog((s) => s.setRecording);
  useEffect(() => {
    setRecording(open);
  }, [open, setRecording]);

  // TIME TRAVEL. `scrubSeq` caps every view at one moment of the tape; null is
  // LIVE (follow the edge). Scrubbing costs nothing to be correct: the views
  // are pure functions of the visible records, and the fold readout is
  // literally re-run from the recorded durable lane (replayTurnProjection) —
  // the same reducers the live store uses, exercised on history.
  const [scrubSeq, setScrubSeq] = useState<number | null>(null);
  const allRecords = useLangyDevLog((s) => s.records);
  const visibleRecords = useMemo(
    () => tapeUpTo(allRecords, scrubSeq),
    [allRecords, scrubSeq],
  );
  const live = scrubSeq === null;

  return (
    <AnimatePresence>
      {open ? (
        <MotionBox
          className="langy-root"
          position="fixed"
          // Anchored to the panel's LEFT edge: offset by the panel's own width
          // plus the gutter, so the drawer and the panel meet without a seam.
          right={
            floating
              ? `calc(${FLOATING_PANEL_CSS_WIDTH} + ${PANEL_INSET * 2 - DRAWER_TUCK}px)`
              : `${SIDEBAR_PANEL_WIDTH - DRAWER_TUCK}px`
          }
          {...(floating
            ? {
                bottom: `${PANEL_INSET}px`,
                maxHeight: "calc(80dvh - 12px)",
                height: "min(560px, calc(80dvh - 12px))",
                // The SAME corner as the panel (20px), not a smaller one of its
                // own: the drawer is the panel's accessory, and two different
                // radii meeting along one edge read as two unrelated cards.
                borderRadius: "20px",
                borderWidth: "1px",
                // The top edge carries 2px. It is the one edge with nothing
                // above it to catch light, so at a hairline it disappeared into
                // the page behind — the drawer read as open at the top.
                borderTopWidth: "2px",
              }
            : {
                top: `${APP_HEADER_HEIGHT}px`,
                bottom: 0,
                borderLeftWidth: "1px",
                borderTopWidth: "2px",
                borderTopLeftRadius: "xl",
              })}
          // The tucked strip is real width that nobody can see, so it is added
          // BACK on both counts: the box grows by it (visible width stays
          // DRAWER_WIDTH) and it becomes right padding (content stops at the
          // panel's edge instead of running underneath it).
          width={`${DRAWER_WIDTH + DRAWER_TUCK}px`}
          paddingRight={`${DRAWER_TUCK}px`}
          maxWidth="calc(100vw - 24px)"
          // Just under the panel: the drawer is its accessory and must never
          // paint over it, or over a drawer-companion arrangement.
          zIndex={1150}
          display="flex"
          flexDirection="column"
          overflow="hidden"
          background="bg.surface"
          borderStyle="solid"
          borderColor="border"
          boxShadow="0 12px 28px rgba(20,20,23,0.12), 0 32px 64px rgba(20,20,23,0.10)"
          _dark={{ boxShadow: "0 12px 28px rgba(0,0,0,0.5)" }}
          role="complementary"
          aria-label="Langy developer inspector"
          initial={reduceMotion ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        >
          <DrawerHeader tab={tab} onTabChange={setTab} onClose={onClose} />
          <TimeScrubber
            records={allRecords}
            visibleRecords={visibleRecords}
            scrubSeq={scrubSeq}
            onScrub={setScrubSeq}
          />
          <Box flex={1} minHeight={0} overflowY="auto">
            {tab === "log" ? (
              <LogTab records={visibleRecords} live={live} />
            ) : null}
            {tab === "tokens" ? (
              <TokensTab records={visibleRecords} live={live} />
            ) : null}
            {tab === "ephemeral" ? (
              <EphemeralTab records={visibleRecords} live={live} />
            ) : null}
            {tab === "events" ? (
              <EventsTab records={visibleRecords} live={live} />
            ) : null}
            {tab === "store" ? <StoreTab /> : null}
          </Box>
        </MotionBox>
      ) : null}
    </AnimatePresence>
  );
}

function DrawerHeader({
  tab,
  onTabChange,
  onClose,
}: {
  tab: DevTab;
  onTabChange: (tab: DevTab) => void;
  onClose: () => void;
}) {
  const clear = useLangyDevLog((s) => s.clear);
  return (
    <VStack align="stretch" gap={0} flexShrink={0}>
      <HStack
        paddingTop="13px"
        paddingBottom="10px"
        paddingLeft="12px"
        paddingRight="8px"
        gap={1}
        borderBottomWidth="1px"
        borderColor="border.muted"
      >
        <Text flex={1} textStyle="sm" fontWeight="600" color="fg">
          Inspector
        </Text>
        <Tooltip content="Clear the tape" positioning={{ placement: "bottom" }}>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Clear the tape"
            color="fg.muted"
            onClick={clear}
          >
            <Eraser size={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content="Close" positioning={{ placement: "bottom" }}>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Close the inspector"
            color="fg.muted"
            onClick={onClose}
          >
            <X size={15} />
          </IconButton>
        </Tooltip>
      </HStack>
      <HStack
        gap={0}
        paddingX="8px"
        paddingY="6px"
        borderBottomWidth="1px"
        borderColor="border.muted"
      >
        {TABS.map(({ id, label }) => (
          <chakra.button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-pressed={tab === id}
            paddingX={2.5}
            paddingY={1}
            borderRadius="md"
            borderWidth={0}
            cursor="pointer"
            textStyle="xs"
            fontWeight="500"
            background={tab === id ? "bg.muted" : "transparent"}
            color={tab === id ? "fg" : "fg.muted"}
          >
            {label}
          </chakra.button>
        ))}
      </HStack>
    </VStack>
  );
}

/**
 * TIME TRAVEL. A bar across the whole recorded tape: drag it and every view
 * caps at that moment — the log, the tokens as they stood, the calls that had
 * settled — and the readout underneath shows the TURN FOLD replayed from the
 * recorded durable lane up to that point, through the same @langwatch/langy
 * reducers the live store runs (ADR-059's replayability, made a control).
 * Snapping to the right edge returns to LIVE, which follows the tape's edge.
 */
function TimeScrubber({
  records,
  visibleRecords,
  scrubSeq,
  onScrub,
}: {
  records: LangyDevLogRecord[];
  visibleRecords: LangyDevLogRecord[];
  scrubSeq: number | null;
  onScrub: (seq: number | null) => void;
}) {
  const live = scrubSeq === null;
  const first = records[0]?.seq ?? 0;
  const last = records.at(-1)?.seq ?? 0;
  const replayed = useMemo(
    () => replayTurnProjection(visibleRecords),
    [visibleRecords],
  );
  if (records.length === 0) return null;
  const at = visibleRecords.at(-1);
  return (
    <VStack
      align="stretch"
      gap={1}
      paddingX="12px"
      paddingY="6px"
      borderBottomWidth="1px"
      borderColor="border.muted"
      flexShrink={0}
    >
      <HStack gap={2}>
        <chakra.input
          type="range"
          aria-label="Scrub through the recorded tape"
          min={first}
          max={last}
          step={1}
          value={scrubSeq ?? last}
          onChange={(event) => {
            const seq = Number(event.currentTarget.value);
            // The right edge IS live — snapping there re-arms following, so
            // the scrubber never leaves you stuck one entry in the past.
            onScrub(seq >= last ? null : seq);
          }}
          flex={1}
          height="4px"
          cursor="pointer"
          accentColor="var(--chakra-colors-orange-solid)"
        />
        <chakra.button
          type="button"
          onClick={() => onScrub(null)}
          borderWidth={0}
          borderRadius="sm"
          paddingX={1.5}
          paddingY={0.5}
          cursor="pointer"
          textStyle="2xs"
          fontWeight="600"
          background={live ? "orange.subtle" : "bg.muted"}
          color={live ? "orange.fg" : "fg.muted"}
        >
          {live ? "LIVE" : "→ live"}
        </chakra.button>
      </HStack>
      <HStack gap={2} align="baseline">
        <Text textStyle="2xs" color="fg.subtle" css={MONO} flexShrink={0}>
          {live
            ? `${records.length} entries`
            : `@ ${at ? new Date(at.atMs).toLocaleTimeString() : "start"} · ${visibleRecords.length}/${records.length}`}
        </Text>
        <Text
          textStyle="2xs"
          color="fg.muted"
          css={MONO}
          flex={1}
          minWidth={0}
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
        >
          fold: {replayed.turn ? (replayed.turn.Status ?? "—") : "—"}
          {replayed.turnId ? ` · turn ${replayed.turnId.slice(-8)}` : ""}
          {replayed.turn ? ` · ${replayed.turn.ToolCalls.length} tools` : ""}
          {replayed.cursor ? ` · cur ${replayed.cursor.acceptedAt}` : ""}
        </Text>
      </HStack>
    </VStack>
  );
}

/** Per-lane colors + direction, so the unified log reads at a glance. */
const LANE_STYLE: Record<
  LangyDevLogRecord["lane"],
  { glyph: string; color: string }
> = {
  outbound: { glyph: "→", color: "blue.fg" },
  stream: { glyph: "←", color: "orange.fg" },
  durable: { glyph: "⇐", color: "purple.fg" },
  signal: { glyph: "·", color: "teal.fg" },
};

/**
 * LOG: the whole tape, every lane interleaved in arrival order. Outbound
 * commands (→), the inbound stream (←), the durable EVENT LOG the fold is
 * built from (⇐), and the freshness signals (·) — on one timeline, because
 * cross-channel ordering ("did the signal beat the stream? did we send before
 * the terminal?") is the thing no partitioned view can show.
 */
function LogTab({
  records,
  live,
}: {
  records: LangyDevLogRecord[];
  live: boolean;
}) {
  const dropped = useLangyDevLog((s) => s.dropped);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ block: "end" });
  }, [records.length, live]);

  if (records.length === 0) {
    return (
      <Empty>
        Nothing on the tape yet. Send a message — outbound commands, the
        stream, the durable event log and freshness signals all land here in
        arrival order.
      </Empty>
    );
  }
  return (
    <Box padding={2}>
      {dropped > 0 ? (
        <Text textStyle="2xs" color="orange.fg" paddingX={1} paddingBottom={2}>
          {dropped.toLocaleString()} earlier entries dropped — the tape keeps
          the most recent {DEV_LOG_CAPACITY.toLocaleString()}.
        </Text>
      ) : null}
      <VStack align="stretch" gap={0.5}>
        {records.map((record) => (
          <LogRow key={record.seq} record={record} />
        ))}
      </VStack>
      <Box ref={endRef} height="1px" />
    </Box>
  );
}

function LogRow({ record }: { record: LangyDevLogRecord }) {
  const [open, setOpen] = useState(false);
  const lane = LANE_STYLE[record.lane];
  return (
    <Box>
      <chakra.button
        type="button"
        onClick={() => setOpen((value) => !value)}
        display="flex"
        alignItems="baseline"
        gap={2}
        width="full"
        textAlign="left"
        paddingX={1}
        paddingY={0.5}
        borderRadius="sm"
        borderWidth={0}
        background="transparent"
        cursor="pointer"
        aria-expanded={open}
        _hover={{ background: "bg.subtle" }}
      >
        <Text
          textStyle="2xs"
          color="fg.subtle"
          flexShrink={0}
          css={MONO}
          minWidth="34px"
        >
          {record.seq}
        </Text>
        <Text
          textStyle="2xs"
          color={lane.color}
          flexShrink={0}
          css={MONO}
          minWidth="12px"
        >
          {lane.glyph}
        </Text>
        <Text
          textStyle="2xs"
          fontWeight="600"
          color={lane.color}
          flexShrink={0}
          minWidth="62px"
        >
          {recordKind(record)}
        </Text>
        <Text
          textStyle="2xs"
          color="fg.muted"
          flex={1}
          minWidth={0}
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
          css={MONO}
        >
          {recordSummary(record)}
        </Text>
      </chakra.button>
      {open ? (
        <Box
          marginX={1}
          marginBottom={1}
          padding={2}
          borderRadius="sm"
          background="bg.subtle"
          textStyle="2xs"
          color="fg.muted"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          css={MONO}
        >
          {JSON.stringify(record, null, 2)}
        </Box>
      ) : null}
    </Box>
  );
}

/** Shared: the "nothing has happened yet" line, so all three tabs say it alike. */
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Text padding={3} textStyle="xs" color="fg.muted">
      {children}
    </Text>
  );
}

const MONO = {
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

function TokensTab({
  records,
  live,
}: {
  records: LangyDevLogRecord[];
  live: boolean;
}) {
  const text = useMemo(() => tokenStreamText(records), [records]);
  const deltaCount = useMemo(
    () =>
      streamRecords(records).filter((record) => record.entry.type === "delta")
        .length,
    [records],
  );

  // Follow the live edge as tokens arrive, the same reflex the conversation
  // has — but never while scrubbing, where the whole point is standing still.
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ block: "end" });
  }, [text, live]);

  if (!text) {
    return (
      <Empty>No tokens yet. Send a message and they will stream here.</Empty>
    );
  }
  return (
    <Box padding={3}>
      <Text textStyle="2xs" color="fg.subtle" marginBottom={2}>
        {deltaCount.toLocaleString()} deltas · {text.length.toLocaleString()}{" "}
        characters
      </Text>
      <Box
        textStyle="xs"
        color="fg"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        lineHeight="1.55"
        css={MONO}
      >
        {text}
      </Box>
      <Box ref={endRef} height="1px" />
    </Box>
  );
}

/**
 * The EPHEMERAL signals: everything on the wire that is not a token and not a
 * tool call.
 *
 * These are the entries that never become message parts — status lines,
 * progress samples, milestones, the model's reasoning, plan snapshots, and the
 * terminal frame. They fork out of the transport into the store to drive the
 * thinking line, the status row and the fold's motion, and then they are gone;
 * nothing persists them, so after the turn settles there is no record of them
 * anywhere else. That is exactly why they are the hardest part of a turn to
 * debug, and why they get their own view.
 *
 * Together with Tokens (deltas) and Events (tool calls), this accounts for
 * every entry on the tape — no kind is invisible in the inspector.
 */
function EphemeralTab({
  records,
  live,
}: {
  records: LangyDevLogRecord[];
  live: boolean;
}) {
  const dropped = useLangyDevLog((s) => s.dropped);
  const signals = useMemo(
    () =>
      streamRecords(records).filter(
        (record) =>
          record.entry.type !== "delta" && record.entry.type !== "tool",
      ),
    [records],
  );
  const counts = useMemo(() => entryKindCounts(signals), [signals]);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ block: "end" });
  }, [signals.length, live]);

  if (signals.length === 0) {
    return (
      <Empty>
        No signals yet — status, progress, reasoning and plan frames land here
        as they arrive.
      </Empty>
    );
  }
  return (
    <Box padding={2}>
      <HStack gap={1.5} flexWrap="wrap" paddingX={1} paddingBottom={2}>
        {counts.map(({ kind, count }) => (
          <Text key={kind} textStyle="2xs" color="fg.subtle">
            {kind} ×{count}
          </Text>
        ))}
      </HStack>
      {dropped > 0 ? (
        // Say so. A silently-truncated tape reads as a complete one, and that
        // is exactly how you end up debugging the wrong half of a turn.
        <Text textStyle="2xs" color="orange.fg" paddingX={1} paddingBottom={2}>
          {dropped.toLocaleString()} earlier entries dropped — the tape keeps
          the most recent {DEV_LOG_CAPACITY.toLocaleString()}.
        </Text>
      ) : null}
      <VStack align="stretch" gap={0.5}>
        {signals.map((record) => (
          <SignalRow key={record.seq} record={record} />
        ))}
      </VStack>
      <Box ref={endRef} height="1px" />
    </Box>
  );
}

function SignalRow({
  record,
}: {
  record: Extract<LangyDevLogRecord, { lane: "stream" }>;
}) {
  const [open, setOpen] = useState(false);
  const { entry } = record;
  // One scannable line, so the list reads without expanding every row.
  const summary =
    entry.type === "status"
      ? entry.status || "(cleared)"
      : entry.type === "error"
        ? entry.error
        : entry.type === "reasoning"
          ? entry.text
          : entry.type === "progress"
            ? (entry.message ?? "")
            : "";

  return (
    <Box>
      <chakra.button
        type="button"
        onClick={() => setOpen((value) => !value)}
        display="flex"
        alignItems="baseline"
        gap={2}
        width="full"
        textAlign="left"
        paddingX={1}
        paddingY={1}
        borderRadius="sm"
        borderWidth={0}
        background="transparent"
        cursor="pointer"
        aria-expanded={open}
        _hover={{ background: "bg.subtle" }}
      >
        <Text
          textStyle="2xs"
          color="fg.subtle"
          flexShrink={0}
          css={MONO}
          minWidth="34px"
        >
          {record.seq}
        </Text>
        <Text
          textStyle="2xs"
          fontWeight="600"
          color={entry.type === "error" ? "red.fg" : "orange.fg"}
          flexShrink={0}
          minWidth="62px"
        >
          {entry.type}
        </Text>
        <Text
          textStyle="2xs"
          color="fg.muted"
          flex={1}
          minWidth={0}
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
          css={MONO}
        >
          {summary}
        </Text>
      </chakra.button>
      {open ? (
        <Box
          marginX={1}
          marginBottom={1}
          padding={2}
          borderRadius="sm"
          background="bg.subtle"
          textStyle="2xs"
          color="fg.muted"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          css={MONO}
        >
          {JSON.stringify(entry, null, 2)}
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * EVENTS: one row per tool call, WITH the card that call produced.
 *
 * Tools and cards were briefly two tabs, and splitting them was wrong — you
 * never want one without the other. The question is always "this call ran, so
 * what did the panel draw for it", and answering it meant holding two lists side
 * by side and matching them up by name.
 *
 * So a row is the whole story: the call folded from its two wire entries (input,
 * output, error, duration), and beneath it what `resolveCliCapability` decided —
 * card kind, surface, tone, body widget. Cards are NOT on the wire; there is no
 * "card event" to record. They are derived here, client-side, from the tool
 * name, which is why a call rendering as a plain activity line instead of a rich
 * card is only ever visible in this view.
 */
function EventsTab({
  records,
  live,
}: {
  records: LangyDevLogRecord[];
  live: boolean;
}) {
  const calls = useMemo(() => toolCallsFrom(records), [records]);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ block: "end" });
  }, [calls.length, live]);

  if (calls.length === 0) {
    return <Empty>No tool calls yet.</Empty>;
  }
  return (
    <VStack align="stretch" gap={1} padding={2}>
      {calls.map((call) => (
        <EventRow key={call.id} call={call} />
      ))}
      <Box ref={endRef} height="1px" />
    </VStack>
  );
}

function EventRow({ call }: { call: DevToolCall }) {
  const [open, setOpen] = useState(false);
  const capability = useMemo(
    () => resolveCliCapability(call.name),
    [call.name],
  );
  const running = call.settledAtMs === undefined;

  return (
    <Box borderRadius="sm" borderWidth="1px" borderColor="border.muted">
      <chakra.button
        type="button"
        onClick={() => setOpen((value) => !value)}
        display="flex"
        alignItems="baseline"
        gap={2}
        width="full"
        textAlign="left"
        paddingX={2}
        paddingY={1.5}
        borderRadius="sm"
        borderWidth={0}
        background="transparent"
        cursor="pointer"
        aria-expanded={open}
        _hover={{ background: "bg.subtle" }}
      >
        <Text
          textStyle="2xs"
          fontWeight="600"
          color={call.isError ? "red.fg" : running ? "fg.muted" : "orange.fg"}
          flex={1}
          minWidth={0}
          whiteSpace="nowrap"
          overflow="hidden"
          textOverflow="ellipsis"
          css={MONO}
        >
          {call.name}
        </Text>
        <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
          {call.isError
            ? "error"
            : running
              ? "running…"
              : `${call.durationMs?.toLocaleString() ?? "?"}ms`}
        </Text>
      </chakra.button>

      <Box paddingX={2} paddingBottom={1.5}>
        {capability ? (
          <HStack gap={1.5} flexWrap="wrap">
            <DevField label="card" value={capability.render} />
            <DevField label="surface" value={capability.surface} />
            <DevField label="tone" value={capability.tone} />
            <DevField label="body" value={capability.body} />
          </HStack>
        ) : (
          <Text textStyle="2xs" color="fg.muted">
            No capability — not a CLI call, so it renders as a plain activity
            line.
          </Text>
        )}
      </Box>

      {open ? (
        <Box
          marginX={2}
          marginBottom={2}
          padding={2}
          borderRadius="sm"
          background="bg.subtle"
          textStyle="2xs"
          color="fg.muted"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          css={MONO}
        >
          {JSON.stringify(
            { input: call.input, output: call.output, isError: call.isError },
            null,
            2,
          )}
        </Box>
      ) : null}
    </Box>
  );
}

function DevField({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={2} align="baseline">
      <Text
        textStyle="2xs"
        color="fg.subtle"
        minWidth="60px"
        flexShrink={0}
        css={MONO}
      >
        {label}
      </Text>
      <Text textStyle="2xs" color="fg" css={MONO}>
        {value}
      </Text>
    </HStack>
  );
}

function StoreTab() {
  // Subscribe to the whole store: this view's entire job is to show it, so the
  // usual "select the narrowest slice" rule is exactly inverted here.
  const state = useLangyStore();
  const rows: { label: string; value: unknown }[] = [
    { label: "turnPhase", value: state.turnPhase },
    { label: "activeTurnId", value: state.activeTurnId },
    { label: "settledTurnId", value: state.settledTurnId },
    { label: "backendSawTurnInFlight", value: state.backendSawTurnInFlight },
    // The LOCAL turn projection (ADR-059): the durable tail folded in the
    // browser. `projection.cursor` against the freshness signal's cursor is
    // THE question when debugging the event stream — is the client behind,
    // and did the fold land?
    { label: "projection.cursor", value: state.turnProjection.cursor },
    { label: "projection.turnId", value: state.turnProjection.turnId },
    {
      label: "projection.turn.Status",
      value: state.turnProjection.turn?.Status ?? null,
    },
    {
      label: "projection.turn.ToolCalls",
      value: state.turnProjection.turn?.ToolCalls?.length ?? null,
    },
    { label: "activeConversationId", value: state.activeConversationId },
    {
      label: "historyLoadConversationId",
      value: state.historyLoadConversationId,
    },
    { label: "turnStatus", value: state.turnStatus },
    { label: "turnProgress", value: state.turnProgress },
    { label: "turnPlan", value: state.turnPlan },
    { label: "turnReasoning", value: state.turnReasoning },
    { label: "panelMode", value: state.panelMode },
    { label: "panelEffect", value: state.panelEffect },
    { label: "attachedContext", value: state.attachedContext },
    { label: "draft", value: state.draft },
    { label: "modelOverride", value: state.modelOverride },
  ];

  return (
    <VStack align="stretch" gap={0} padding={2}>
      {rows.map(({ label, value }) => (
        <HStack
          key={label}
          align="baseline"
          gap={2}
          paddingX={1}
          paddingY={1}
          borderBottomWidth="1px"
          borderColor="border.muted"
        >
          <Text
            textStyle="2xs"
            color="fg.muted"
            flexShrink={0}
            minWidth="150px"
            css={MONO}
          >
            {label}
          </Text>
          <Text
            textStyle="2xs"
            color="fg"
            flex={1}
            minWidth={0}
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            css={MONO}
          >
            {formatStoreValue(value)}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

/** Render a store value legibly — and never dump a whole streamed essay. */
function formatStoreValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") {
    return value.length > 240 ? `${value.slice(0, 240)}…` : value || '""';
  }
  const json = JSON.stringify(value);
  if (json === undefined) return String(value);
  return json.length > 240 ? `${json.slice(0, 240)}…` : json;
}
