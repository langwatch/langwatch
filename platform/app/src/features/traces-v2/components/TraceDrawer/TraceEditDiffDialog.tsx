import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { applyOverlayToTraceHeader } from "~/server/traces/edit-overlay/applyTraceEditOverlayToViews";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import { applyOverlayToSpansFull, useSpansFullCanonical } from "../../hooks/useSpansFull";
import { useTraceHeaderCanonical } from "../../hooks/useTraceHeader";
import { SegmentedToggle } from "./SegmentedToggle";
import { computeLineDiff, type DiffLine, diffStat } from "@langwatch/coding-agent-web";

type DiffTab = "trace" | "spans";

/** Unchanged lines kept either side of a change, so a hunk reads in context. */
const CONTEXT_LINES = 3;

interface TraceEditDiffDialogProps {
  open: boolean;
  onClose: () => void;
  patch: TraceEditOverlayPatch;
}

/**
 * The full difference between the trace as captured and the trace as
 * corrected, line by line.
 *
 * The comparison is over the pretty-printed payloads rather than a field-level
 * walk: a correction can change anything, and a reviewer checking their own
 * work wants to read the same shape they read everywhere else in the drawer.
 */
export function TraceEditDiffDialog({ open, onClose, patch }: TraceEditDiffDialogProps) {
  // Null until the reader picks a side themselves, so the dialog can keep
  // opening on whichever one has something to read as the payloads land.
  const [pickedTab, setPickedTab] = useState<DiffTab | null>(null);
  const { traceLines, spansLines, traceStat, spansStat } = useTraceEditDiff({
    open,
    patch,
  });

  // A correction that only touched spans used to open on the trace tab, which
  // greeted the reader with "No changes" about a trace they had just corrected.
  // The trace tab still wins when both changed: it is the whole trace, and the
  // span differences are one click away.
  const tab = pickedTab ?? defaultDiffTab({ traceStat, spansStat });
  const lines = tab === "trace" ? traceLines : spansLines;
  const stat = tab === "trace" ? traceStat : spansStat;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) {
          // The pick belongs to one reading of the difference. The dialog stays
          // mounted between openings, so keeping it would land the next one on
          // a side that may have nothing to read this time.
          setPickedTab(null);
          onClose();
        }
      }}
      size="xl"
      placement="center"
    >
      <Dialog.Content bg="bg" maxHeight="85vh" display="flex" flexDirection="column">
        <Dialog.Header borderBottomWidth="1px" borderColor="border">
          <HStack gap={3} align="center">
            <Dialog.Title>
              <Text textStyle="md" fontWeight="semibold">
                Trace edits
              </Text>
            </Dialog.Title>
            {/* Each tab carries its own counts, so the reader can see which
                part of the trace changed without opening both. */}
            <SegmentedToggle
              value={tab}
              onChange={(next) => setPickedTab(next as DiffTab)}
              options={[
                { value: "trace", label: tabLabel("trace", traceStat) },
                { value: "spans", label: tabLabel("spans", spansStat) },
              ]}
            />
          </HStack>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body padding={0} overflow="auto" flex={1}>
          <DiffHunks lines={lines} stat={stat} />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * Both sides of the difference, each already diffed and counted, so the dialog
 * can label a tab with what it holds before the reader opens it.
 */
function useTraceEditDiff({
  open,
  patch,
}: {
  open: boolean;
  patch: TraceEditOverlayPatch;
}): {
  traceLines: DiffLine[];
  spansLines: DiffLine[];
  traceStat: DiffStat;
  spansStat: DiffStat;
} {
  const headerQuery = useTraceHeaderCanonical();
  const spansQuery = useSpansFullCanonical(open);

  const tracePair = useMemo(() => {
    const header = headerQuery.data;
    if (!header) return { before: "", after: "" };
    return {
      before: prettyJson(header),
      after: prettyJson(applyOverlayToTraceHeader({ header, patch })),
    };
  }, [headerQuery.data, patch]);

  const spansPair = useMemo(() => {
    const spans = spansQuery.data;
    if (!spans) return { before: "", after: "" };
    return {
      before: prettyJson(spans),
      after: prettyJson(applyOverlayToSpansFull({ spans, patch })),
    };
  }, [spansQuery.data, patch]);

  const traceLines = useMemo(
    () => computeLineDiff(tracePair.before, tracePair.after),
    [tracePair.before, tracePair.after],
  );
  const spansLines = useMemo(
    () => computeLineDiff(spansPair.before, spansPair.after),
    [spansPair.before, spansPair.after],
  );
  const traceStat = useMemo(() => diffStat(traceLines), [traceLines]);
  const spansStat = useMemo(() => diffStat(spansLines), [spansLines]);

  return { traceLines, spansLines, traceStat, spansStat };
}

/** The lines of one side, or a note that this side is unchanged. */
function DiffHunks({ lines, stat }: { lines: DiffLine[]; stat: DiffStat }) {
  const hunks = useMemo(() => collapseUnchanged(lines), [lines]);

  if (!hasChanges(stat)) {
    return (
      <VStack gap={2} paddingY={8} justify="center">
        <Text textStyle="xs" color="fg.muted">
          No changes
        </Text>
      </VStack>
    );
  }

  return (
    <Box
      as="pre"
      margin={0}
      paddingY={2}
      fontFamily="mono"
      textStyle="xs"
      lineHeight="1.6"
    >
      {hunks.map((entry, index) =>
        entry === "gap" ? (
          <GapRow key={`gap-${index}`} />
        ) : (
          <DiffRow key={index} line={entry} />
        ),
      )}
    </Box>
  );
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

interface DiffStat {
  added: number;
  removed: number;
}

function hasChanges(stat: DiffStat): boolean {
  return stat.added > 0 || stat.removed > 0;
}

/** The tab that has something to show, trace first when both do. */
export function defaultDiffTab({
  traceStat,
  spansStat,
}: {
  traceStat: DiffStat;
  spansStat: DiffStat;
}): DiffTab {
  if (hasChanges(traceStat)) return "trace";
  if (hasChanges(spansStat)) return "spans";
  return "trace";
}

function tabLabel(name: DiffTab, stat: DiffStat): string {
  return `${name} +${stat.added} -${stat.removed}`;
}

/**
 * Drops runs of unchanged lines that sit far from any change, leaving a marker
 * where they were. A corrected trace payload is mostly unchanged, and scrolling
 * past thousands of identical lines to find three edited ones is not reading a
 * diff.
 */
export function collapseUnchanged(lines: DiffLine[]): (DiffLine | "gap")[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === "context") return;
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(lines.length - 1, index + CONTEXT_LINES);
    for (let i = from; i <= to; i++) keep[i] = true;
  });

  const out: (DiffLine | "gap")[] = [];
  let skipping = false;
  lines.forEach((line, index) => {
    if (keep[index]) {
      out.push(line);
      skipping = false;
      return;
    }
    if (!skipping) {
      out.push("gap");
      skipping = true;
    }
  });
  return out;
}

function GapRow() {
  return (
    <HStack as="span" display="flex" gap={0} paddingLeft="4.7em">
      <Text as="span" color="fg.subtle" userSelect="none">
        ⋯
      </Text>
    </HStack>
  );
}

/** How each kind of diff line reads: its tint, its sign, and its text colour. */
const DIFF_ROW_STYLE: Record<
  DiffLine["kind"],
  { bg?: string; marker: string; sign: string; text: string }
> = {
  add: { bg: "green.subtle", marker: "green.fg", sign: "+", text: "green.fg" },
  remove: { bg: "red.subtle", marker: "red.fg", sign: "-", text: "red.fg" },
  context: { marker: "fg.muted", sign: " ", text: "fg" },
};

function DiffRow({ line }: { line: DiffLine }) {
  const style = DIFF_ROW_STYLE[line.kind];
  const lineNo = line.kind === "add" ? line.newLineNo : line.oldLineNo;

  return (
    <HStack as="span" display="flex" gap={0} align="stretch" bg={style.bg}>
      <Text
        as="span"
        color="fg.subtle"
        textAlign="right"
        width="3.5em"
        flexShrink={0}
        paddingRight={2}
        userSelect="none"
      >
        {lineNo ?? ""}
      </Text>
      <Text as="span" color={style.marker} width="1.2em" flexShrink={0} userSelect="none">
        {style.sign}
      </Text>
      <Text
        as="span"
        color={style.text}
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        flex={1}
        minWidth={0}
      >
        {line.text || " "}
      </Text>
    </HStack>
  );
}
