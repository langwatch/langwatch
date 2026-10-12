import { EmptyValue } from "@langwatch/design-system/empty-value";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import { formatLatency } from "@langwatch/design-system/metric-value-formatters";
import { Badge, Box, HStack, Table, Text, VStack } from "@langwatch/design-system/primitives";
import { ProviderIcon } from "@langwatch/design-system/provider-icons";

import {
  formatMetricValue,
  formatUsd,
  metricNoun,
  type ListMetric,
} from "../../../model/experiments/experiment-list-metrics.ts";
import {
  decidedItems,
  gapOf,
  MIN_DECIDED_ITEMS_TO_CALL,
  rankTargets,
  tieNoteOf,
  type RankedTarget,
  type TargetResult,
} from "../../../model/experiments/experiment-list-targets.ts";
import { PanelTable } from "./panel-table.tsx";

/**
 * Every target of the latest run, best first: provider mark, the metric with a thin bar on its own
 * 0 to 100 scale, the gap to the top target in words, items, cost, p50 latency and failed answers.
 * A tie with the leader is said once above the table, never crowned.
 */
export function ExperimentTargetsTable({
  targets,
  metric,
  runNumber,
}: {
  targets: TargetResult[];
  metric: ListMetric;
  runNumber: number;
}) {
  const ranked = rankTargets({ targets, metric });
  const isRate = metric.kind === "passRate";
  const best = ranked[0];
  const second = ranked[1];
  const tooFew =
    isRate &&
    ranked.some((entry) => decidedItems(entry.target, metric) < MIN_DECIDED_ITEMS_TO_CALL);
  const tieNote = isRate ? tieNoteOf({ ranked, tooFew }) : undefined;
  const unscored = targets.filter(
    (target) => !ranked.some((entry) => entry.target.id === target.id),
  );
  const leaderGap =
    isRate && best && second && !tieNote
      ? gapOf({ a: best.target, b: second.target, metric, delta: best.value - second.value })
      : undefined;
  return (
    <Box paddingY={2}>
      <Text textStyle="bodySm">
        <Text as="span" fontWeight="medium">
          Every target, run #{runNumber}
        </Text>
        {!isRate && (
          <Text as="span" color="fg.muted">
            {" · "}
            {metricNoun(metric)}, highest first. No winner is marked: LangWatch stores no better
            direction for a score.
          </Text>
        )}
        {leaderGap && best && second && (
          <Text as="span" color="fg.muted">
            {" · top "}
            <Text as="span" fontWeight="medium" color="fg">
              {best.target.label}
            </Text>{" "}
            {formatMetricValue(metric, best.value)}, {leaderGap.text} of {second.target.label}
          </Text>
        )}
      </Text>
      {tieNote && (
        <Text textStyle="bodySm" color="fg.muted">
          <Text as="span" fontWeight="medium" color="fg">
            {tieNote.lead}
          </Text>{" "}
          {tieNote.rest}
        </Text>
      )}
      <PanelTable marginTop={1}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader width="22%">Target</Table.ColumnHeader>
            <Table.ColumnHeader width="12%" textAlign="end">
              {metric.label}
            </Table.ColumnHeader>
            <Table.ColumnHeader width="14%">
              {isRate && best ? `vs ${best.target.label}` : ""}
            </Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Items</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Cost</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">p50 latency</Table.ColumnHeader>
            <Table.ColumnHeader width="26%">Errors</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {[...ranked, ...unscored.map((target) => ({ target, value: undefined, rank: 0 }))].map(
            ({ target, value, rank }) => (
              <TargetRow
                key={target.id}
                target={target}
                value={value}
                rank={rank}
                metric={metric}
                best={best}
                crowned={
                  isRate &&
                  rank === 1 &&
                  !tieNote &&
                  ranked.length > 1 &&
                  decidedItems(target, metric) >= MIN_DECIDED_ITEMS_TO_CALL
                }
                allTop={ranked.length > 0 && ranked.every((entry) => entry.rank === 1)}
              />
            ),
          )}
        </Table.Body>
      </PanelTable>
    </Box>
  );
}

function TargetRow({
  target,
  value,
  rank,
  metric,
  best,
  crowned,
  allTop,
}: {
  target: TargetResult;
  value: number | undefined;
  rank: number;
  metric: ListMetric;
  best: RankedTarget | undefined;
  crowned: boolean;
  allTop: boolean;
}) {
  const isRate = metric.kind === "passRate";
  const leading = rank === 1 && decidedItems(target, metric) >= MIN_DECIDED_ITEMS_TO_CALL;
  const gap =
    isRate && best && value !== undefined && best.target.id !== target.id
      ? gapOf({ a: target, b: best.target, metric, delta: value - best.value })
      : undefined;
  return (
    <Table.Row data-testid={`target-row-${target.id}`}>
      <Table.Cell>
        <HStack gap={2} minWidth={0}>
          {target.model && <ProviderIcon model={target.model} size="comfortable" />}
          <Text lineClamp={1} title={target.label}>
            {target.label}
          </Text>
          {crowned && (
            <Badge size="sm" colorPalette="green" variant="subtle">
              best
            </Badge>
          )}
        </HStack>
      </Table.Cell>
      <Table.Cell>
        {value === undefined ? (
          <HStack justify="end">
            <EmptyValue label="Not scored" />
          </HStack>
        ) : (
          <VStack align="end" gap={0.5}>
            <Text
              fontWeight={leading && !allTop ? "semibold" : "medium"}
              fontVariantNumeric="tabular-nums"
            >
              {formatMetricValue(metric, value)}
            </Text>
            {isRate && (
              <MeterBar
                fillRatio={value / 100}
                width="100%"
                height="3px"
                fillColor={leading ? "blue.solid" : "blue.muted"}
              />
            )}
          </VStack>
        )}
      </Table.Cell>
      <Table.Cell>
        {gap && (
          <Badge size="sm" variant="subtle" colorPalette={gap.ahead ? "green" : "red"}>
            {gap.text}
          </Badge>
        )}
      </Table.Cell>
      <Table.Cell textAlign="end" color="fg.muted" fontVariantNumeric="tabular-nums">
        {target.items.toLocaleString("en-US")}
      </Table.Cell>
      <Table.Cell textAlign="end" color="fg.muted" fontVariantNumeric="tabular-nums">
        {formatUsd(target.costUsd ?? null)}
      </Table.Cell>
      <Table.Cell textAlign="end" color="fg.muted" fontVariantNumeric="tabular-nums">
        {formatLatency(target.p50Ms ?? null)}
      </Table.Cell>
      <Table.Cell>
        {target.errors > 0 ? (
          <Text lineClamp={1} title={target.firstError}>
            <Text as="span" color="orange.fg">
              {target.errors} {target.errors === 1 ? "error" : "errors"}
            </Text>
            {target.firstError && (
              <Text as="span" color="fg.muted">
                {" · “"}
                {target.firstError}”
              </Text>
            )}
          </Text>
        ) : (
          <Text color="fg.muted">none</Text>
        )}
      </Table.Cell>
    </Table.Row>
  );
}
