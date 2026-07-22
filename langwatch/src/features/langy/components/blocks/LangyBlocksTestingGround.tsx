/**
 * The blocks testing ground — every ADR-060 variant, in every state, from
 * fixtures, INTERACTIVE. Rendered by the developer-mode card gallery so the
 * whole channel can be exercised by eye without waiting for a live turn to
 * produce each condition:
 *
 *   - a streaming playground that feeds a real fence through the REAL
 *     preview reducer chunk by chunk (play/step/replay), so the
 *     no-preview-until-validating and grows-as-points-arrive behaviours are
 *     visible, not asserted;
 *   - every derived kind settled (timeseries with comparison + hints, table
 *     with a ragged row, numeric and mixed stats);
 *   - the failed-block disclosure (expand it);
 *   - every choices state, live: an OPEN question you can actually answer
 *     (it locks, exactly as the fold would render it), multi-select,
 *     free-text Other, hydrated live/dead refs, superseded, forming.
 *
 * These are the real components fed real-shaped data — the same rule the
 * rest of the gallery holds itself to.
 */
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import {
  feedLangyCardBlockPreview,
  initialLangyCardBlockPreview,
  type LangyCardBlock,
  type LangyChoicesBlock,
  type LangyChoiceSelection,
  type LangyChoicesLockState,
} from "@langwatch/langy";
import { Pause, Play, RotateCcw, StepForward } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { LangyChoicesCard } from "./LangyChoicesCard";
import { LangyDerivedBlockCard } from "./LangyDerivedBlockCard";
import { LangyFailedBlockCard } from "./LangyFailedBlockCard";
import type { ChoicesRefRow } from "./useChoicesRefRows";

// ─── fixtures ────────────────────────────────────────────────────────────────

const TIMESERIES: LangyCardBlock = {
  kind: "timeseries",
  blockId: "gallery-ts",
  title: "Cost per day — derived from the dataset",
  unit: "usd",
  series: [
    {
      name: "cost",
      points: [
        { t: "Jul 15", v: 0.11 },
        { t: "Jul 16", v: 0.28 },
        { t: "Jul 17", v: 0.19 },
        { t: "Jul 18", v: 0.22 },
        { t: "Jul 19", v: 0.31 },
        { t: "Jul 20", v: 0.74 },
        { t: "Jul 21", v: 0.36 },
      ],
    },
  ],
  comparison: {
    label: "This week",
    value: 2.21,
    baselineLabel: "Last week",
    baseline: 1.37,
  },
  hints: [{ type: "explore", query: { query: "checkout" } }, { type: "verify" }],
};

const TABLE: LangyCardBlock = {
  kind: "table",
  blockId: "gallery-table",
  title: "Failures by model — derived grouping",
  columns: ["model", "failures", "share"],
  rows: [
    ["gpt-5-mini", 41, "58%"],
    ["claude-sonnet", 22, "31%"],
    ["llama-3.3", 8, "11%"],
    // A ragged row renders short rather than failing the block.
    ["gemini-2.5"],
  ],
};

const STATS_NUMERIC: LangyCardBlock = {
  kind: "stats",
  blockId: "gallery-stats",
  title: "Yesterday, at a glance",
  items: [
    { label: "traces", value: 1204 },
    { label: "p95 latency", value: 812, unit: "ms" },
    { label: "failures", value: 41 },
  ],
};

const STATS_MIXED: LangyCardBlock = {
  kind: "stats",
  blockId: "gallery-stats-mixed",
  title: "Mixed figures fall back to the grid",
  items: [
    { label: "slowest model", value: "llama-3.3" },
    { label: "p95 latency", value: 812, unit: "ms" },
  ],
};

const CHOICES: LangyChoicesBlock = {
  kind: "choices",
  blockId: "gallery-choices",
  question: "Which agent should this scenario run against?",
  options: [
    { id: "staging", label: "Staging agent", description: "Cheap, safe" },
    { id: "prod", label: "Production agent", description: "The live one" },
    { id: "local", label: "Local dev agent", description: "Your machine" },
  ],
};

const CHOICES_REFS: LangyChoicesBlock = {
  kind: "choices",
  blockId: "gallery-choices-refs",
  question: "Options grounded in real entities — hydrated as the viewer",
  options: [
    {
      id: "live",
      label: "checkout-agent",
      ref: { type: "agent", id: "agent_live" },
    },
    {
      id: "dead",
      label: "retired-agent",
      ref: { type: "agent", id: "agent_gone" },
    },
  ],
};

const REF_ROWS: ReadonlyMap<string, ChoicesRefRow> = new Map([
  [
    "live",
    {
      state: "live",
      primary: "checkout-agent",
      secondary: "updated 2h ago · 96% pass",
    },
  ],
  ["dead", { state: "dead" }],
]);

/** The streamed fence body, cut where a stream plausibly would cut it. */
const STREAM_CHUNKS: string[] = (() => {
  const full =
    '{"kind": "timeseries", "blockId": "gallery-stream", "title": "Forming as it streams", "series": [{"name": "cost", "points": [' +
    '{"t": "Mon", "v": 4}, {"t": "Tue", "v": 7}, {"t": "Wed", "v": 5}, {"t": "Thu", "v": 9}, {"t": "Fri", "v": 12}]}]}';
  const cuts = [12, 34, 58, 90, 108, 126, 144, 162, 180, full.length];
  return cuts.map((cut) => full.slice(0, cut));
})();

// ─── interactive pieces ──────────────────────────────────────────────────────

/**
 * Feed the real preview reducer one cumulative chunk at a time. What you see
 * is the reducer's contract: nothing until a prefix validates, then a card
 * that grows, then the settled render when the stream completes.
 */
function StreamingPlayground() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const done = step >= STREAM_CHUNKS.length - 1;

  useEffect(() => {
    if (!playing || done) return;
    const timer = setInterval(
      () => setStep((current) => current + 1),
      450,
    );
    return () => clearInterval(timer);
  }, [playing, done]);

  const preview = useMemo(
    () =>
      STREAM_CHUNKS.slice(0, step + 1).reduce(
        feedLangyCardBlockPreview,
        initialLangyCardBlockPreview,
      ),
    [step],
  );

  return (
    <VStack align="stretch" gap={2}>
      <HStack gap={1.5}>
        <Button size="xs" variant="outline" onClick={() => setPlaying((p) => !p)}>
          {playing ? <Pause size={12} /> : <Play size={12} />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={done}
          onClick={() => setStep((current) => current + 1)}
        >
          <StepForward size={12} /> Step
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            setStep(0);
            setPlaying(false);
          }}
        >
          <RotateCcw size={12} /> Replay
        </Button>
        <Text textStyle="2xs" color="fg.subtle">
          chunk {step + 1}/{STREAM_CHUNKS.length}
        </Text>
      </HStack>
      {preview.block ? (
        <LangyDerivedBlockCard card={preview.block} forming={!done} />
      ) : (
        <Text textStyle="2xs" color="fg.subtle">
          No preview yet — nothing shown until a prefix validates.
        </Text>
      )}
      <Box
        as="pre"
        textStyle="2xs"
        fontFamily="mono"
        color="fg.muted"
        background="bg.muted"
        borderRadius="sm"
        padding={2}
        whiteSpace="pre-wrap"
        wordBreak="break-all"
        maxHeight="80px"
        overflowY="auto"
      >
        {preview.raw || "…"}
      </Box>
    </VStack>
  );
}

/**
 * A live choices card with the lock state derived from what YOU do to it —
 * answer it and it locks with the choice marked; supersede it and it grays;
 * reset and it reopens. The same derivation the fold drives in the panel.
 */
function ChoicesPlayground({
  card,
  refRowsOverride,
}: {
  card: LangyChoicesBlock;
  refRowsOverride?: ReadonlyMap<string, ChoicesRefRow>;
}) {
  const [selection, setSelection] = useState<LangyChoiceSelection | null>(null);
  const [movedOn, setMovedOn] = useState(false);

  const lockState: LangyChoicesLockState = selection
    ? {
        status: "answered",
        optionIds: selection.optionIds,
        ...(selection.otherText !== undefined
          ? { otherText: selection.otherText }
          : {}),
      }
    : movedOn
      ? { status: "superseded" }
      : { status: "open" };

  return (
    <VStack align="stretch" gap={1.5}>
      <LangyChoicesCard
        card={card}
        lockState={lockState}
        onSelect={({ selection: next }) => setSelection(next)}
        refRowsOverride={refRowsOverride}
      />
      <HStack gap={1.5}>
        <Button
          size="xs"
          variant="ghost"
          color="fg.muted"
          disabled={!!selection || movedOn}
          onClick={() => setMovedOn(true)}
        >
          Type a message instead (supersede)
        </Button>
        <Button
          size="xs"
          variant="ghost"
          color="fg.muted"
          disabled={!selection && !movedOn}
          onClick={() => {
            setSelection(null);
            setMovedOn(false);
          }}
        >
          <RotateCcw size={12} /> Reset
        </Button>
      </HStack>
    </VStack>
  );
}

// ─── the ground itself ───────────────────────────────────────────────────────

export function LangyBlocksTestingGround() {
  return (
    <VStack align="stretch" gap={4}>
      <Labeled label="Progressive preview — the real reducer, chunk by chunk">
        <StreamingPlayground />
      </Labeled>

      <Labeled label="Derived timeseries — comparison headline, explore + verify hints">
        <VerifyDemo />
      </Labeled>

      <Labeled label="Derived table — ragged rows render short, never fail">
        <LangyDerivedBlockCard card={TABLE} />
      </Labeled>

      <Labeled label="Derived stats — numeric figures roll up">
        <LangyDerivedBlockCard card={STATS_NUMERIC} />
      </Labeled>

      <Labeled label="Derived stats — mixed values fall back to the grid">
        <LangyDerivedBlockCard card={STATS_MIXED} />
      </Labeled>

      <Labeled label="Forming chrome — what a mid-stream card wears">
        <LangyDerivedBlockCard card={STATS_NUMERIC} forming />
      </Labeled>

      <Labeled label="Failed block — the disclosure, never silence (expand it)">
        <LangyFailedBlockCard
          part={{
            type: "langy-card-failed",
            blockId: "gallery-failed",
            raw: '{"kind": "traces", "traces": [{"trace_id": "tr_fabricated"}]}',
          }}
        />
      </Labeled>

      <Labeled label="Choices — answer it, supersede it, reset it">
        <ChoicesPlayground card={CHOICES} />
      </Labeled>

      <Labeled label="Choices — multi-select with Answer">
        <ChoicesPlayground
          card={{
            ...CHOICES,
            blockId: "gallery-choices-multi",
            question: "Which suites should run tonight?",
            multiSelect: true,
          }}
        />
      </Labeled>

      <Labeled label="Choices — Other allows a free-text answer">
        <ChoicesPlayground
          card={{
            ...CHOICES,
            blockId: "gallery-choices-other",
            allowOther: true,
          }}
        />
      </Labeled>

      <Labeled label="Choices — entity refs: live row and dead (disabled) row">
        <ChoicesPlayground card={CHOICES_REFS} refRowsOverride={REF_ROWS} />
      </Labeled>

      <Labeled label="Choices — forming (never answerable mid-stream)">
        <LangyChoicesCard
          card={CHOICES}
          lockState={{ status: "open" }}
          forming
        />
      </Labeled>
    </VStack>
  );
}

/** The verify hint, demonstrably bound: click it, see what would be sent. */
function VerifyDemo() {
  const [sent, setSent] = useState(false);
  return (
    <VStack align="stretch" gap={1.5}>
      <LangyDerivedBlockCard
        card={TIMESERIES}
        projectSlug="demo"
        onVerify={() => setSent(true)}
      />
      {sent ? (
        <HStack gap={1.5}>
          <Text textStyle="2xs" color="green.fg">
            Would send: &quot;Verify &quot;Cost per day — derived from the
            dataset&quot; with a real analytics query…&quot;
          </Text>
          <Button size="xs" variant="ghost" onClick={() => setSent(false)}>
            <RotateCcw size={12} /> Reset
          </Button>
        </HStack>
      ) : null}
    </VStack>
  );
}

function Labeled({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <VStack align="stretch" gap={1.5}>
      <Text textStyle="2xs" color="fg.subtle" fontWeight="560">
        {label}
      </Text>
      {children}
    </VStack>
  );
}
