/**
 * A kept statement replayed over its fixed window, lent through `LwqlReplayChartToken`
 * (§10.1). The run is the reader's own, so a statement the reader may not run shows the
 * door's refusal and never a number.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { LwqlReplayChartProps } from "@langwatch/analytics-client";
import type { LangWatchQLDatasetColumn } from "@langwatch/analytics-contract/visualization";
import { Box, HStack, Spinner, Text } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { useMemo } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useLwqlReplay } from "../../behavior/use-lwql-replay.ts";
import { LazyLangWatchQLWidgetChart } from "./langwatch-ql-dashboard-widget.tsx";

export function LwqlReplayChart({ sql, window, parameters, name }: LwqlReplayChartProps) {
  const host = useAnalyticsHost();
  const { result, error } = useLwqlReplay({
    projectId: host.project()?.id,
    sql,
    start: window.start,
    end: window.end,
    granularitySeconds: window.granularitySeconds,
    ...(parameters ? { parameters } : {}),
  });
  const columns = useMemo(
    () => (result?.columns ?? []) as readonly LangWatchQLDatasetColumn[],
    [result],
  );

  if (error) {
    return (
      <Box padding={3}>
        <HandledErrorAlert error={error} fallbackTitle="Couldn't replay this query" />
      </Box>
    );
  }
  if (!result) {
    return (
      <HStack gap={2} color="fg.muted" padding={4}>
        <Spinner size="sm" />
        <Text fontSize="13px">Replaying the query</Text>
      </HStack>
    );
  }
  return <LazyLangWatchQLWidgetChart columns={columns} rows={result.rows} ariaLabel={name} />;
}
