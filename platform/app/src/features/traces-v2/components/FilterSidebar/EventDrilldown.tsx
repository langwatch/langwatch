import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { LiqeQuery } from "liqe";
import type React from "react";
import { getFacetValueState } from "~/server/app-layer/traces/query-language/queries";
import { RowButton } from "./RowButton";
import type { EventMetricValues, FacetItem } from "./types";
import { formatCount } from "./utils";

/** Storage prefix stripped from metric keys for DISPLAY only — filters and
 *  value lookups always use the full key. Matches the ingest mapper's
 *  `event.metrics.` prefix (see facets/events.ts on the server). */
const EVENT_METRICS_DISPLAY_PREFIX = "event.metrics.";

const MIN_VISIBLE_FILL_PCT = 4;

interface EventDrilldownProps {
  /** The event FacetItem (must carry eventMetrics). */
  item: FacetItem;
  ast: LiqeQuery;
  /**
   * Toggle a single top-level `event.attribute.<metric key>` clause. Plain
   * facet toggle, no group mutation: the emitted predicate is trace-scoped,
   * so ANDed event filters may match different events within one trace —
   * a documented, accepted limitation (same-event pairing would need a
   * grammar extension).
   */
  toggleFacet: ({ field, value }: { field: string; value: string }) => void;
}

/**
 * Inline drilldown rendered under an event-name row (thumbs_up_down →
 * vote values 1 / -1 with counts). Renders purely from `item.eventMetrics`,
 * which the discover endpoint already attached — no query of its own,
 * mirroring EvaluatorDrilldown.
 *
 * Values are shown and filtered verbatim as stored: a stored "1" becomes
 * `event.attribute.event.metrics.vote:1`, character for character, so the
 * filter round-trips against the string the ingest wrote.
 */
export const EventDrilldown: React.FC<EventDrilldownProps> = ({
  item,
  ast,
  toggleFacet,
}) => {
  const metrics = item.eventMetrics ?? [];
  if (metrics.length === 0) return null;

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
  metric: EventMetricValues;
  ast: LiqeQuery;
  toggleFacet: EventDrilldownProps["toggleFacet"];
}> = ({ metric, ast, toggleFacet }) => {
  const field = `event.attribute.${metric.key}`;
  const displayKey = metric.key.startsWith(EVENT_METRICS_DISPLAY_PREFIX)
    ? metric.key.slice(EVENT_METRICS_DISPLAY_PREFIX.length)
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
            displayKey={displayKey}
            count={v.count}
            maxCount={maxCount}
            state={state}
            onClick={() => toggleFacet({ field, value: v.value })}
          />
        );
      })}
    </VStack>
  );
};

/**
 * One clickable metric value — the sidebar's compact row language (count,
 * proportional fill on the bottom edge, subtle-bg when active), pared down
 * from EvaluatorDrilldown's ValueRow: no dot (metric values are free-form
 * stored strings, not a closed enum), and state comes from the top-level
 * AST clause rather than an evaluator group.
 */
const MetricValueRow: React.FC<{
  value: string;
  displayKey: string;
  count: number;
  maxCount: number;
  state: "neutral" | "include" | "exclude";
  onClick: () => void;
}> = ({ value, displayKey, count, maxCount, state, onClick }) => {
  const active = state !== "neutral";
  const palette = state === "exclude" ? "red" : "blue";
  const fillPct =
    maxCount > 0 ? Math.max((count / maxCount) * 100, MIN_VISIBLE_FILL_PCT) : 0;
  // The key qualifies the value because an event can carry several metrics,
  // and two of them may offer the same value ("1" under both `vote` and
  // `rating`). The state word says which way the filter points: "active"
  // alone reads identically for an included and an excluded value.
  const stateLabel =
    state === "include"
      ? "included"
      : state === "exclude"
        ? "excluded"
        : "click to filter";
  return (
    <RowButton
      type="button"
      aria-label={`${displayKey} ${value} — ${stateLabel}`}
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
          {value}
        </Text>
        <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
          {formatCount(count)}
        </Text>
      </HStack>
    </RowButton>
  );
};
