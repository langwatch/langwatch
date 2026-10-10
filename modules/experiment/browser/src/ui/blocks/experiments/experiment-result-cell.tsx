import { EmptyValue } from "@langwatch/design-system/empty-value";
import { HStack, Text, VStack } from "@langwatch/design-system/primitives";

import {
  formatMetricValue,
  metricNoun,
  type ResultHeadline,
} from "../../../model/experiments/experiment-list-metrics.ts";

/**
 * The row's headline: the primary metric's value, the metric's name, and, when the newest run
 * has none, why an older run is shown. The same two lines open or closed.
 */
export function ExperimentResultCell({ headline }: { headline: ResultHeadline | undefined }) {
  if (!headline) {
    return <EmptyValue label="No result yet" />;
  }
  const { metric, value, note } = headline;
  return (
    <VStack align="start" gap={1}>
      <HStack gap={2} align="baseline" flexWrap="wrap">
        <Text textStyle="metric">{formatMetricValue(metric, value)}</Text>
        <Text textStyle="caption" color="fg.muted">
          {metricNoun(metric)}
        </Text>
      </HStack>
      <Text textStyle="caption" color="fg.muted" lineClamp={1}>
        {note ?? metric.label}
      </Text>
    </VStack>
  );
}
