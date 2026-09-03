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
  LangyCardHint,
  LangyChoiceSelection,
  LangyChoicesLockState,
  LangyDerivedCard,
  LangyDerivedChoicesCard,
  LangyDerivedStatsCard,
  LangyDerivedTableCard,
} from "@langwatch/langy-contract";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";
import { StreamingStatCard } from "../streaming-stat-card";
import { LangyChoicesCard, type ChoicesRefRow } from "./langy-choices-card";
import { LangyDerivedCardFrame } from "./langy-derived-card-frame";

export type LangyExploreLinkProps = {
  href: string;
  children: ReactNode;
};

export type LangyDerivedCardPorts = {
  renderTimeseries?: (
    card: Extract<LangyDerivedCard, { kind: "timeseries" }>,
  ) => ReactNode;
  renderExploreLink?: (props: LangyExploreLinkProps) => ReactNode;
  resolveExploreHref?: (
    query: Record<string, unknown>,
    projectSlug: string | null,
  ) => string | null;
  choiceRefRows?: ReadonlyMap<string, ChoicesRefRow>;
};

export type LangyDerivedCardViewProps = {
  card: LangyDerivedCard;
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
    card: LangyDerivedChoicesCard;
  }) => void;
  /** Verify hint: ask Langy to run the real query. Absent = chip hidden. */
  onVerify?: (a: { card: LangyDerivedCard }) => void;
} & LangyDerivedCardPorts;

export function LangyDerivedCardView({
  card,
  hints,
  forming = false,
  projectSlug,
  choicesLockState,
  onChoiceSelect,
  onVerify,
  renderTimeseries,
  renderExploreLink,
  resolveExploreHref,
  choiceRefRows,
}: LangyDerivedCardViewProps) {
  if (card.kind === "choices") {
    return (
      <LangyChoicesCard
        card={card}
        forming={forming}
        lockState={choicesLockState ?? { status: "open" }}
        onSelect={onChoiceSelect}
        refRows={choiceRefRows}
      />
    );
  }

  const boundHints = bindHints({
    card,
    hints: hints ?? card.hints ?? [],
    projectSlug: projectSlug ?? null,
    onVerify: forming ? undefined : onVerify,
    renderExploreLink,
    resolveExploreHref,
  });

  return (
    <LangyDerivedCardFrame
      title={card.title}
      forming={forming}
      actions={boundHints.length > 0 ? boundHints : undefined}
    >
      <DerivedBlockBody card={card} renderTimeseries={renderTimeseries} />
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
  renderTimeseries,
}: {
  card: Exclude<LangyDerivedCard, { kind: "choices" }>;
  renderTimeseries?: LangyDerivedCardPorts["renderTimeseries"];
}) {
  switch (card.kind) {
    case "timeseries":
      // The SAME plot the measured analytics card draws — one chart body,
      // two provenances, told apart by the frame alone.
      return renderTimeseries ? (
        renderTimeseries(card)
      ) : (
        <Text textStyle="xs" color="fg.muted">
          No chart renderer configured.
        </Text>
      );
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

function DerivedTableBody({ card }: { card: LangyDerivedTableCard }) {
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

function DerivedStatsBody({ card }: { card: LangyDerivedStatsCard }) {
  const numeric = card.items.every((item) => typeof item.value === "number");
  if (numeric) {
    // The measured stat figures, reused — value roll-up and all.
    return (
      <StreamingStatCard
        metrics={card.items.flatMap((item) =>
          typeof item.value === "number"
            ? [
                {
                  value: item.value,
                  label: item.label,
                  ...(item.unit !== undefined ? { suffix: item.unit } : {}),
                },
              ]
            : [],
        )}
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
            {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
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
  renderExploreLink,
  resolveExploreHref,
}: {
  card: LangyDerivedCard;
  hints: LangyCardHint[];
  projectSlug: string | null;
  onVerify?: (a: { card: LangyDerivedCard }) => void;
  renderExploreLink?: LangyDerivedCardPorts["renderExploreLink"];
  resolveExploreHref?: LangyDerivedCardPorts["resolveExploreHref"];
}): ReactNode[] {
  const chips: ReactNode[] = [];
  for (const hint of hints) {
    if (hint.type === "explore") {
      // The same normalization the explorer handoff already applies to the
      // CLI's own searches: only a query that survives it earns a link. An
      // origin counts too — a model authoring `{ origin: "evaluation" }` is
      // a real, narrowed hint (`origin` is a named field in the query
      // language it's told about), not an empty one.
      const href = resolveExploreHref?.(hint.query, projectSlug);
      if (!href) continue;
      const Link = renderExploreLink ?? DefaultExploreLink;
      chips.push(
        <Link key="explore" href={href}>
          Open in Traces
        </Link>,
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

function DefaultExploreLink({ href, children }: LangyExploreLinkProps) {
  return (
    <a href={href}>
      {children}
      <ArrowUpRight size={12} />
    </a>
  );
}
