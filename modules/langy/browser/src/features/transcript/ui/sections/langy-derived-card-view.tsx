import { Link } from "@langwatch/browser-host/link";
import { ListTable } from "@langwatch/design-system/list-table";
import { MeterBar } from "@langwatch/design-system/meter-bar";
/**
 * The derived-block dispatcher — one stamped `langy-card` part in, the card it
 * validates as out (ADR-060 §3).
 */
import { Box, Grid, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type {
  LangyCardHint,
  LangyChoiceSelection,
  LangyChoicesLockState,
  LangyDerivedCard,
  LangyDerivedChoicesCard,
  LangyDerivedInsightsCard,
  LangyDerivedStatsCard,
  LangyDerivedTableCard,
  LangyInsightsCardFinding,
} from "@langwatch/langy-contract";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import type { ReactNode } from "react";

import { LangyCardActionChip } from "../../../../ui/elements/langy-card-action-chip.tsx";
import { LangyChoicesCard } from "../../../../ui/sections/derived-cards/langy-choices-card.tsx";
import { LangyDerivedCardFrame } from "../../../../ui/sections/derived-cards/langy-derived-card-frame.tsx";
import { StreamingStatCard } from "../../../../ui/sections/streaming-stat-card.tsx";
import type { ChoicesRefRow } from "../../../langy/behavior/derived-cards/use-choices-ref-rows.ts";
import { formatStatFigure, isComparableSeries } from "../../model/langy-stat-figure.ts";

export type LangyExploreLinkProps = {
  href: string;
  children: ReactNode;
};

export type LangyDerivedCardMembers = {
  renderTimeseries?: (card: Extract<LangyDerivedCard, { kind: "timeseries" }>) => ReactNode;
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
  onChoiceSelect?: (a: { selection: LangyChoiceSelection; card: LangyDerivedChoicesCard }) => void;
  /** Verify hint: ask Langy to run the real query. Absent = chip hidden. */
  onVerify?: (a: { card: LangyDerivedCard }) => void;
} & LangyDerivedCardMembers;

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
 * Kind → body, one flat exhaustive dispatch (the registry idiom the capability cards
 * use).
 */
function DerivedBlockBody({
  card,
  renderTimeseries,
}: {
  card: Exclude<LangyDerivedCard, { kind: "choices" }>;
  renderTimeseries?: LangyDerivedCardMembers["renderTimeseries"];
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
    case "insights":
      return <DerivedInsightsBody card={card} />;
  }
}

/** Cap so a long list of findings stays a card, not a page. */
const MAX_FINDING_ROWS = 10;

/**
 * The verdict as the next step, on its colour. `good` is no longer asked for; its label stays
 * so a card from before then still reads.
 */
const FINDING_TONE: Record<LangyInsightsCardFinding["tone"], { label: string; color: string }> = {
  bad: { label: "Act now", color: "red.solid" },
  watch: { label: "Check this", color: "yellow.solid" },
  good: { label: "Good news", color: "green.solid" },
};

/** One row per finding: the verdict and topic, the headline, then the body as Langy wrote it. */
function DerivedInsightsBody({ card }: { card: LangyDerivedInsightsCard }) {
  if (card.findings.length === 0) {
    return (
      <Text textStyle="xs" color="fg.muted">
        Nothing new to report.
      </Text>
    );
  }
  const shown = card.findings.slice(0, MAX_FINDING_ROWS);
  const remaining = card.findings.length - shown.length;
  return (
    <VStack as="ul" align="stretch" gap={3} listStyleType="none">
      {shown.map((finding, index) => (
        <Box as="li" key={index} data-testid="derived-insight-finding" data-tone={finding.tone}>
          <HStack gap={2} marginBottom={1}>
            <Box
              as="span"
              flexShrink={0}
              borderRadius="sm"
              paddingX="6px"
              paddingY="2px"
              textStyle="2xs"
              fontWeight="700"
              letterSpacing="0.08em"
              textTransform="uppercase"
              color="white"
              background={FINDING_TONE[finding.tone].color}
            >
              {FINDING_TONE[finding.tone].label}
            </Box>
            {finding.topic ? (
              <Text
                textStyle="2xs"
                fontWeight="600"
                letterSpacing="0.08em"
                textTransform="uppercase"
                color="fg.subtle"
              >
                {finding.topic}
              </Text>
            ) : null}
          </HStack>
          <Text textStyle="xs" fontWeight="640" color="fg" lineHeight="1.3">
            {finding.title}
          </Text>
          <Text textStyle="xs" color="fg.muted" whiteSpace="pre-wrap" wordBreak="break-word">
            {finding.body}
          </Text>
        </Box>
      ))}
      {remaining > 0 ? (
        <Text as="li" textStyle="2xs" color="fg.subtle">
          +{remaining.toLocaleString()} more findings in the reply
        </Text>
      ) : null}
    </VStack>
  );
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
    <Box>
      <ListTable
        variant="embedded"
        density="compact"
        scroll="x"
        scrollLabel={`${card.title} table`}
      >
        <ListTable.Header>
          <ListTable.Row>
            {card.columns.map((column) => (
              <ListTable.ColumnHeader key={column}>{column}</ListTable.ColumnHeader>
            ))}
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {shown.map((row, rowIndex) => (
            <ListTable.Row key={rowIndex}>
              {card.columns.map((_, columnIndex) => (
                <ListTable.Cell key={columnIndex}>
                  <Text as="span" textStyle="xs" color="fg" fontVariantNumeric="tabular-nums">
                    {formatCell(row[columnIndex])}
                  </Text>
                </ListTable.Cell>
              ))}
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
      {remaining > 0 ? (
        <Text textStyle="2xs" color="fg.subtle" paddingTop={1}>
          +{remaining.toLocaleString()} more rows in the reply
        </Text>
      ) : null}
    </Box>
  );
}

function DerivedStatsBody({ card }: { card: LangyDerivedStatsCard }) {
  // Readings on one scale are a comparison, and a comparison reads as bars.
  // A row of large figures says which numbers exist; bars say which is bigger,
  // which is the whole question an optimization report answers. Bars also fit
  // the panel at any item count, where the figure row runs off its edge.
  if (isComparableSeries(card.items)) {
    return <DerivedStatsBars card={card} />;
  }

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
            {formatStatFigure(
              item.unit ? { value: item.value, unit: item.unit } : { value: item.value },
            )}
          </Text>
        </Box>
      ))}
    </Grid>
  );
}

/**
 * One bar per reading, all measured against the largest, so the winner is
 * visible before a single number is read. The bar is a proportion of the
 * series, not of a hard 100: a set topping out at 45 still fills the track.
 */
function DerivedStatsBars({ card }: { card: LangyDerivedStatsCard }) {
  const values = card.items.map((item) => Number(item.value));
  const peak = Math.max(...values, 0);
  const best = Math.max(...values);

  return (
    <Box display="flex" flexDirection="column" gap={2.5} width="full">
      {card.items.map((item, index) => {
        const value = values[index]!;
        return (
          <Box
            key={`${item.label}-${index}`}
            width="full"
            data-testid="derived-stat-bar"
            data-best={value === best ? "true" : undefined}
          >
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="baseline"
              gap={2}
              marginBottom={1}
            >
              <Text textStyle="2xs" color="fg.muted" wordBreak="break-word">
                {item.label}
              </Text>
              <Text
                textStyle="xs"
                fontWeight="600"
                color="fg"
                fontVariantNumeric="tabular-nums"
                flexShrink={0}
              >
                {formatStatFigure(
                  item.unit ? { value: item.value, unit: item.unit } : { value: item.value },
                )}
              </Text>
            </Box>
            <MeterBar
              fillRatio={peak > 0 ? value / peak : null}
              width="100%"
              height="6px"
              fillColor={value === best ? "green.solid" : "blue.solid"}
            />
          </Box>
        );
      })}
    </Box>
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
  renderExploreLink?: LangyDerivedCardMembers["renderExploreLink"];
  resolveExploreHref?: LangyDerivedCardMembers["resolveExploreHref"];
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
        <LangyCardActionChip
          key="verify"
          label="Verify with a real query"
          icon={<BadgeCheck size={12} />}
          onClick={() => onVerify({ card })}
        />,
      );
    }
  }
  return chips;
}

function DefaultExploreLink({ href, children }: LangyExploreLinkProps) {
  return (
    <Link unstyled href={href}>
      {children}
      <ArrowUpRight size={12} />
    </Link>
  );
}
