import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { LiqeQuery } from "liqe";
import type React from "react";
import {
  EVENT_METRICS_PREFIX,
  eventMetricValueLabel,
  getFacetValueState,
} from "@langwatch/trace-contract";
import { RowButton } from "../../../elements/explorer/filter-sidebar/row-button";
import type {
  EventMetricValues,
  FacetItem,
} from "../../../../behavior/explorer/filter-sidebar/types";
import { formatCount } from "./utils";

const MIN_VISIBLE_FILL_PCT = 4;

interface EventDrilldownProps {
  /** The event FacetItem (must carry eventMetrics). */
  item: FacetItem;
  ast: LiqeQuery;
  /**
   * Toggle one top-level facet clause: `event.attribute.<metric key>` and,
   * when the row is inactive, the `event:<type>` anchor added ahead of it.
   * Two different active events still AND as trace-scoped subqueries — an
   * accepted limitation; this only fixes the unscoped case.
   */
  toggleFacet: ({ field, value }: { field: string; value: string }) => void;
}

/**
 * Inline drilldown under an event-name row, rendered purely from
 * `item.eventMetrics` the discover endpoint already attached — no query of
 * its own. Labels are humanised, values are not: a row reads "thumbs down"
 * and emits the stored string verbatim so the filter round-trips.
 */
export const EventDrilldown: React.FC<EventDrilldownProps> = ({ item, ast, toggleFacet }) => {
  const metrics = item.eventMetrics ?? [];
  if (metrics.length === 0) return null;

  // Whether `event:<item.value>` is already an active top-level clause. On
  // an inactive row a metric click adds the anchor first — the attribute
  // clause alone would match the same metric under another event type.
  const eventActive = getFacetValueState(ast, "event", item.value) === "include";

  return (
    // Same visual attachment as EvaluatorDrilldown: indented under the row
    // with a hairline guide, no card chrome.
    <Box
      marginLeft="20px"
      marginTop={0.5}
      marginBottom={1}
      paddingLeft={2}
      borderLeftWidth="1px"
      borderLeftColor="border.muted"
      data-spotlight="event-drilldown"
    >
      <VStack align="stretch" gap={1}>
        {metrics.map((metric) => (
          <MetricGroup
            key={metric.key}
            eventType={item.value}
            eventActive={eventActive}
            metric={metric}
            ast={ast}
            toggleFacet={toggleFacet}
          />
        ))}
      </VStack>
    </Box>
  );
};

const MetricGroup: React.FC<{
  eventType: string;
  /** True when `event:<eventType>` is already an active clause — see
   *  {@link EventDrilldown}. */
  eventActive: boolean;
  metric: EventMetricValues;
  ast: LiqeQuery;
  toggleFacet: EventDrilldownProps["toggleFacet"];
}> = ({ eventType, eventActive, metric, ast, toggleFacet }) => {
  const field = `event.attribute.${metric.key}`;
  const displayKey = metric.key.startsWith(EVENT_METRICS_PREFIX)
    ? metric.key.slice(EVENT_METRICS_PREFIX.length)
    : metric.key;
  const maxCount = Math.max(...metric.values.map((v) => v.count), 0);

  return (
    <VStack align="stretch" gap={0}>
      <Text
        textStyle="2xs"
        color="fg.subtle"
        fontWeight="medium"
        paddingLeft={1.5}
        paddingBottom={0.5}
      >
        {displayKey}
      </Text>
      {metric.values.map((v) => {
        const state = getFacetValueState(ast, field, v.value);
        return (
          <MetricValueRow
            key={v.value}
            value={v.value}
            displayValue={eventMetricValueLabel({
              eventType,
              metricKey: metric.key,
              value: v.value,
            })}
            displayKey={displayKey}
            count={v.count}
            maxCount={maxCount}
            state={state}
            onClick={() => {
              // Scope the metric to its event BEFORE the metric clause
              // lands, so the pair always reads as one predicate rather
              // than a metric value floating unscoped at the top level.
              if (!eventActive) {
                toggleFacet({ field: "event", value: eventType });
              }
              toggleFacet({ field, value: v.value });
            }}
          />
        );
      })}
    </VStack>
  );
};

/**
 * One clickable metric value in the sidebar's compact row language, pared
 * down from the evaluator drilldown's value row: no dot, and state comes
 * from the top-level AST clause rather than an evaluator group.
 */
const MetricValueRow: React.FC<{
  /** The stored string — what the filter is built from. */
  value: string;
  /** What the user reads: "thumbs down" where the wire says "-1". */
  displayValue: string;
  displayKey: string;
  count: number;
  maxCount: number;
  state: "neutral" | "include" | "exclude";
  onClick: () => void;
}> = ({ value: _value, displayValue, displayKey, count, maxCount, state, onClick }) => {
  const active = state !== "neutral";
  const palette = state === "exclude" ? "red" : "blue";
  const fillPct = maxCount > 0 ? Math.max((count / maxCount) * 100, MIN_VISIBLE_FILL_PCT) : 0;
  // The key qualifies the value: two metrics on one event may share a value
  // ("1" under both `vote` and `rating`). The state word says which way the
  // filter points — "active" alone cannot tell include from exclude.
  const stateLabel =
    state === "include" ? "included" : state === "exclude" ? "excluded" : "click to filter";
  return (
    <RowButton
      type="button"
      aria-label={`${displayKey} ${displayValue} — ${stateLabel}`}
      data-state={state}
      position="relative"
      width="full"
      paddingY={0.5}
      paddingLeft={1.5}
      paddingRight={0}
      cursor="pointer"
      textAlign="left"
      borderRadius="sm"
      overflow="hidden"
      background={active ? `${palette}.subtle` : "transparent"}
      borderWidth={0}
      onClick={onClick}
      transition="background 120ms ease"
      _hover={{
        background: active ? `${palette}.subtle` : "bg.muted",
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <Box
        position="absolute"
        bottom={0}
        left={0}
        width={`${fillPct}%`}
        height="2px"
        bg={`${palette}.solid`}
        opacity={0.55}
        pointerEvents="none"
      />
      {active && (
        <Box
          position="absolute"
          top={0}
          right={0}
          bottom={0}
          width="2px"
          bg={`${palette}.solid`}
          pointerEvents="none"
        />
      )}
      <HStack justify="space-between" gap={1} paddingRight={1.5}>
        <Text textStyle="2xs" color="fg.muted" truncate>
          {displayValue}
        </Text>
        <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
          {formatCount(count)}
        </Text>
      </HStack>
    </RowButton>
  );
};
