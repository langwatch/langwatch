import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { Dialog } from "~/components/ui/dialog";
import { applyOverlayToTraceHeader } from "~/server/traces/edit-overlay/applyTraceEditOverlay";
import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";
import {
  applyOverlayToSpansFull,
  useSpansFullCanonical,
} from "../../hooks/useSpansFull";
import { useTraceHeaderCanonical } from "../../hooks/useTraceHeader";
import { SegmentedToggle } from "./SegmentedToggle";
import { computeLineDiff, type DiffLine, diffStat } from "./terminalView/diff";

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
export function TraceEditDiffDialog({
  open,
  onClose,
  patch,
}: TraceEditDiffDialogProps) {
  const [tab, setTab] = useState<DiffTab>("trace");
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

  const pair = tab === "trace" ? tracePair : spansPair;
  const lines = useMemo(
    () => computeLineDiff(pair.before, pair.after),
    [pair.before, pair.after],
  );
  const stat = useMemo(() => diffStat(lines), [lines]);
  const hunks = useMemo(() => collapseUnchanged(lines), [lines]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      size="xl"
      placement="center"
    >
      <Dialog.Content
        bg="bg"
        maxHeight="85vh"
        display="flex"
        flexDirection="column"
      >
        <Dialog.Header borderBottomWidth="1px" borderColor="border">
          <HStack gap={3} align="center">
            <Dialog.Title>
              <Text textStyle="md" fontWeight="semibold">
                Trace edits
              </Text>
            </Dialog.Title>
            <SegmentedToggle
              value={tab}
              onChange={(next) => setTab(next as DiffTab)}
              options={["trace", "spans"]}
            />
            <Box flex={1} />
            <Text textStyle="2xs" fontFamily="mono" color="green.fg">
              +{stat.added}
            </Text>
            <Text textStyle="2xs" fontFamily="mono" color="red.fg">
              -{stat.removed}
            </Text>
          </HStack>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body padding={0} overflow="auto" flex={1}>
          {stat.added === 0 && stat.removed === 0 ? (
            <VStack gap={2} paddingY={8} justify="center">
              <Text textStyle="xs" color="fg.muted">
                No changes
              </Text>
            </VStack>
          ) : (
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
          )}
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
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
      <Text
        as="span"
        color={style.marker}
        width="1.2em"
        flexShrink={0}
        userSelect="none"
      >
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
