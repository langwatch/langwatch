import { EmptyValue } from "@langwatch/design-system/empty-value";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import { formatCost, formatLatency } from "@langwatch/design-system/metric-value-formatters";
import { Badge, Box, HStack, Table, Text } from "@langwatch/design-system/primitives";
import { ProviderIcon } from "@langwatch/design-system/provider-icons";

import {
  formatMetricValue,
  metricNoun,
  type ListMetric,
} from "../../../model/experiments/experiment-list-metrics.ts";
import {
  decidedItems,
  describeGap,
  hasTooFewItems,
  isTied,
  MIN_DECIDED_ITEMS_TO_CALL,
  rankTargets,
  type RankedTarget,
  type TargetResult,
} from "../../../model/experiments/experiment-list-targets.ts";

/**
 * Every target of the latest run, best first: provider mark, a bar on the metric's own 0 to 100
 * scale, the gap to the best one in words, items, cost, p50 latency and failed answers. A tie with
 * the leader is said once above the table, never crowned.
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
  const leaders = ranked.filter((entry) => entry.rank === 1).length;
  const topTied = isRate && ranked.length > 1 && leaders > 1;
  const tooFew =
    isRate &&
    ranked.some((entry) => decidedItems(entry.target, metric) < MIN_DECIDED_ITEMS_TO_CALL);
  const unscored = targets.filter(
    (target) => !ranked.some((entry) => entry.target.id === target.id),
  );
  return (
    <Box paddingY={2}>
      <Text textStyle="label">
        Every target, run #{runNumber}
        <Text as="span" fontWeight="normal" color="fg.muted">
          {" · "}
          {metricNoun(metric)}
          {!isRate && ", highest first. A score has no stored better direction, so none is marked"}
        </Text>
      </Text>
      {topTied && (
        <Text textStyle="caption" color="fg.muted" marginTop={1}>
          {tooFew
            ? `Too few items to call a winner: a target needs at least ${MIN_DECIDED_ITEMS_TO_CALL} scored items.`
            : null}
          {!tooFew && (
            <>
              No clear winner: {leaders === ranked.length ? `all ${leaders}` : `the top ${leaders}`}{" "}
              are within noise.
            </>
          )}
        </Text>
      )}
      <Table.Root size="sm" variant="line" marginTop={2}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader width="28%">Target</Table.ColumnHeader>
            <Table.ColumnHeader width="22%">{metric.label}</Table.ColumnHeader>
            <Table.ColumnHeader>
              {isRate && best ? `vs ${best.target.label}` : ""}
            </Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Items</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Cost</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">p50 latency</Table.ColumnHeader>
            <Table.ColumnHeader>Errors</Table.ColumnHeader>
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
                leads={isRate && rank === 1 && !topTied && ranked.length > 1}
              />
            ),
          )}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

function TargetRow({
  target,
  value,
  rank,
  metric,
  best,
  leads,
}: {
  target: TargetResult;
  value: number | undefined;
  rank: number;
  metric: ListMetric;
  best: RankedTarget | undefined;
  leads: boolean;
}) {
  const isRate = metric.kind === "passRate";
  const showGap = isRate && !!best && value !== undefined && best.target.id !== target.id;
  return (
    <Table.Row data-testid={`target-row-${target.id}`}>
      <Table.Cell>
        <HStack gap={2}>
          {target.model && <ProviderIcon model={target.model} size="comfortable" />}
          <Text lineClamp={1} title={target.label}>
            {target.label}
          </Text>
          {leads && (
            <Badge size="sm" colorPalette="green" variant="subtle">
              best
            </Badge>
          )}
        </HStack>
      </Table.Cell>
      <Table.Cell>
        {value === undefined ? (
          <EmptyValue label="Not scored" />
        ) : (
          <HStack gap={2}>
            <Text fontWeight={rank === 1 ? "semibold" : "normal"} minWidth="52px">
              {formatMetricValue(metric, value)}
            </Text>
            {isRate && (
              <MeterBar
                fillRatio={value / 100}
                width="64px"
                height="6px"
                fillColor={rank === 1 ? "blue.solid" : "blue.muted"}
              />
            )}
          </HStack>
        )}
      </Table.Cell>
      <Table.Cell>
        {showGap && (
          <Text textStyle="caption" color="fg.muted">
            {gapText({ a: target, b: best.target, metric, delta: value - best.value })}
          </Text>
        )}
      </Table.Cell>
      <Table.Cell textAlign="end">{target.items.toLocaleString("en-US")}</Table.Cell>
      <Table.Cell textAlign="end">{formatCost(target.costUsd ?? null)}</Table.Cell>
      <Table.Cell textAlign="end">{formatLatency(target.p50Ms ?? null)}</Table.Cell>
      <Table.Cell>
        {target.errors > 0 ? (
          <Text color="orange.fg" lineClamp={1} title={target.firstError}>
            {target.errors} {target.errors === 1 ? "error" : "errors"}
          </Text>
        ) : (
          <Text color="fg.muted">none</Text>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

function gapText({
  a,
  b,
  metric,
  delta,
}: {
  a: TargetResult;
  b: TargetResult;
  metric: ListMetric;
  delta: number;
}): string {
  if (hasTooFewItems({ a, b, metric })) return "too few items";
  return isTied({ a, b, metric }) ? "tied" : describeGap(delta);
}
