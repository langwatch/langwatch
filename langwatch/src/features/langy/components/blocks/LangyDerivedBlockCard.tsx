/**
 * The derived-block dispatcher — one stamped `langy-card` part in, the card
 * it validates as out (ADR-060 §3). Registry-shaped like the capability
 * card switch: a kind this switch has never heard of cannot occur (the part
 * parsed against the closed allowlist), and every body renders inside the
 * ONE derived frame — provenance is the frame's job, never a body's.
 *
 * Bodies reuse the measured kit where a widget exists: the timeseries block
 * draws through the SAME `TimeseriesPlot` the analytics card uses (the
 * chrome, not the chart, is what says derived), stats reuse the stat-card
 * figures when numeric. The table body is new — no measured card renders a
 * generic column/row table.
 *
 * Affordance hints are BOUND here, platform-side (ADR-060 §5): an `explore`
 * hint becomes a Trace Explorer link only when the existing explorer-handoff
 * seam can carry the query (otherwise it silently drops); a `verify` hint
 * becomes "Verify with a real query", which asks Langy — through the
 * ordinary send path — to run the platform computation, so the measured
 * result arrives as an ordinary measured card. The model never authors a
 * URL, an action, or a component.
 */
import { Box, Button, Grid, Table, Text } from "@chakra-ui/react";
import type {
  LangyCardBlock,
  LangyCardHint,
  LangyChoicesBlock,
  LangyChoiceSelection,
  LangyChoicesLockState,
  LangyStatsBlock,
  LangyTableBlock,
} from "@langwatch/langy";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";

import { LangySpaAnchor } from "../LangySpaAnchor";
import { StreamingStatCard } from "../StreamingStatCard";
import { TimeseriesPlot } from "../capabilities/LangyTimeseriesCard";
import {
  buildTraceExplorerHref,
  readTraceSearchQuery,
} from "../../logic/traceExplorerLink";
import { LangyChoicesCard } from "./LangyChoicesCard";
import { LangyDerivedCardFrame } from "./LangyDerivedCardFrame";

export interface LangyDerivedBlockCardProps {
  card: LangyCardBlock;
  /** Hints stamped on the part (already schema-validated by the kernel). */
  hints?: LangyCardHint[];
  /** Still streaming — renders the forming chrome (ADR-060 §7). */
  forming?: boolean;
  projectSlug?: string | null;
  /** Choices only: the lock state derived from the recorded conversation. */
  choicesLockState?: LangyChoicesLockState;
  /** Choices only: answer the question. Absent = read-only (time travel). */
  onChoiceSelect?: (a: {
    selection: LangyChoiceSelection;
    card: LangyChoicesBlock;
  }) => void;
  /** Verify hint: ask Langy to run the real query. Absent = chip hidden. */
  onVerify?: (a: { card: LangyCardBlock }) => void;
}

export function LangyDerivedBlockCard({
  card,
  hints,
  forming = false,
  projectSlug,
  choicesLockState,
  onChoiceSelect,
  onVerify,
}: LangyDerivedBlockCardProps) {
  if (card.kind === "choices") {
    return (
      <LangyChoicesCard
        card={card}
        forming={forming}
        lockState={choicesLockState ?? { status: "open" }}
        onSelect={onChoiceSelect}
      />
    );
  }

  const boundHints = bindHints({
    card,
    hints: hints ?? card.hints ?? [],
    projectSlug: projectSlug ?? null,
    onVerify: forming ? undefined : onVerify,
  });

  return (
    <LangyDerivedCardFrame
      title={card.title}
      forming={forming}
      actions={boundHints.length > 0 ? boundHints : undefined}
    >
      <DerivedBlockBody card={card} />
    </LangyDerivedCardFrame>
  );
}

/**
 * Kind → body, one flat exhaustive dispatch (the registry idiom the
 * capability cards use). The union is closed at the schema, so a kind this
 * switch has not heard of cannot reach it — and if the allowlist ever grows,
 * the missing case is a compile error here, not a blank card.
 */
function DerivedBlockBody({
  card,
}: {
  card: Exclude<LangyCardBlock, { kind: "choices" }>;
}) {
  switch (card.kind) {
    case "timeseries":
      // The SAME plot the measured analytics card draws — one chart body,
      // two provenances, told apart by the frame alone.
      return <TimeseriesPlot payload={card} />;
    case "table":
      return <DerivedTableBody card={card} />;
    case "stats":
      return <DerivedStatsBody card={card} />;
  }
}

/** Cap so a runaway model table stays a card, not a page (ADR-060 open q.). */
const MAX_TABLE_ROWS = 30;

/** One cell, one rule per primitive — flat, no branching in the JSX. */
function formatCell(cell: string | number | boolean | null | undefined): string {
  if (cell === null || cell === undefined) return "—";
  if (typeof cell === "boolean") return cell ? "yes" : "no";
  if (typeof cell === "number") return cell.toLocaleString();
  return cell;
}

function DerivedTableBody({ card }: { card: LangyTableBlock }) {
  const shown = card.rows.slice(0, MAX_TABLE_ROWS);
  const remaining = card.rows.length - shown.length;
  return (
    <Box overflowX="auto">
      <Table.Root size="sm" variant="line">
        <Table.Header>
          <Table.Row background="transparent">
            {card.columns.map((column) => (
              <Table.ColumnHeader
                key={column}
                textStyle="2xs"
                color="fg.subtle"
                textTransform="uppercase"
                letterSpacing="0.03em"
                fontWeight="500"
              >
                {column}
              </Table.ColumnHeader>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {shown.map((row, rowIndex) => (
            <Table.Row key={rowIndex} background="transparent">
              {card.columns.map((_, columnIndex) => (
                <Table.Cell
                  key={columnIndex}
                  textStyle="xs"
                  color="fg"
                  fontVariantNumeric="tabular-nums"
                >
                  {formatCell(row[columnIndex])}
                </Table.Cell>
              ))}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      {remaining > 0 ? (
        <Text textStyle="2xs" color="fg.subtle" paddingTop={1}>
          +{remaining.toLocaleString()} more rows in the reply
        </Text>
      ) : null}
    </Box>
  );
}

function DerivedStatsBody({ card }: { card: LangyStatsBlock }) {
  const numeric = card.items.every((item) => typeof item.value === "number");
  if (numeric) {
    // The measured stat figures, reused — value roll-up and all.
    return (
      <StreamingStatCard
        metrics={card.items.map((item) => ({
          value: item.value as number,
          label: item.label,
          ...(item.unit !== undefined ? { suffix: item.unit } : {}),
        }))}
      />
    );
  }
  return (
    <Grid templateColumns="max-content 1fr" columnGap={3} rowGap={0.5}>
      {card.items.map((item) => (
        <Box key={item.label} display="contents">
          <Text textStyle="2xs" color="fg.subtle">
            {item.label}
          </Text>
          <Text textStyle="xs" color="fg" wordBreak="break-word">
            {typeof item.value === "number"
              ? item.value.toLocaleString()
              : item.value}
            {item.unit ? ` ${item.unit}` : ""}
          </Text>
        </Box>
      ))}
    </Grid>
  );
}

/**
 * Validate-and-bind the hint vocabulary (ADR-060 §5). Returns rendered chips
 * for the hints the platform can honour; anything it cannot validate renders
 * nothing, silently — the card otherwise renders normally.
 */
function bindHints({
  card,
  hints,
  projectSlug,
  onVerify,
}: {
  card: LangyCardBlock;
  hints: LangyCardHint[];
  projectSlug: string | null;
  onVerify?: (a: { card: LangyCardBlock }) => void;
}): ReactNode[] {
  const chips: ReactNode[] = [];
  for (const hint of hints) {
    if (hint.type === "explore") {
      // The same normalization the explorer handoff already applies to the
      // CLI's own searches: only a query that survives it earns a link.
      const search = readTraceSearchQuery(hint.query);
      if (
        search.query === undefined &&
        search.startDate === undefined &&
        search.endDate === undefined
      ) {
        continue; // nothing the explorer can carry — drop, silently
      }
      const href = buildTraceExplorerHref({ projectSlug, search });
      if (!href) continue;
      chips.push(
        <LangySpaAnchor
          key="explore"
          href={href}
          display="inline-flex"
          alignItems="center"
          gap={1}
          textStyle="xs"
          fontWeight="560"
          color="orange.solid"
          _hover={{ textDecoration: "underline" }}
        >
          Open in Traces
          <ArrowUpRight size={12} />
        </LangySpaAnchor>,
      );
      continue;
    }
    // verify — the derived-vs-measured bridge. Only offered when the panel
    // can actually route the request (live conversation, not time travel).
    if (onVerify) {
      chips.push(
        <Button
          key="verify"
          size="xs"
          variant="outline"
          onClick={() => onVerify({ card })}
        >
          <BadgeCheck size={12} /> Verify with a real query
        </Button>,
      );
    }
  }
  return chips;
}
