/**
 * The evidence under an insight: its query replayed over the fixed window it was filed with,
 * and the line that says which dates and values those were. Analytics lends the chart
 * (§10.1) and runs it as the reader. Draws nothing without a query, a window or a lender.
 */

import { LwqlReplayChartToken } from "@langwatch/analytics-client";
import { useLent } from "@langwatch/browser-host/lent";
import { Box, Text } from "@langwatch/design-system/primitives";
import type { InsightEntry } from "@langwatch/insight-contract";
import { Suspense } from "react";

import { replayCaption } from "../../model/insight-presentation.ts";

export function InsightEvidence({ entry }: { entry: InsightEntry }) {
  const Chart = useLent(LwqlReplayChartToken);
  const { lwql, replay } = entry;
  if (!Chart || !lwql || !replay) return null;

  return (
    <Box
      as="figure"
      aria-label="Evidence"
      marginTop={3}
      maxWidth="640px"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      background="bg.panel"
      overflow="hidden"
    >
      <Box height="176px" paddingX={2} paddingTop={2} paddingBottom={1} overflowY="auto">
        <Suspense fallback={null}>
          <Chart
            sql={lwql}
            window={{
              start: replay.start,
              end: replay.end,
              granularitySeconds: replay.granularitySeconds,
            }}
            parameters={replay.parameters}
            name={entry.board?.widget?.name ?? entry.title}
          />
        </Suspense>
      </Box>
      <Text as="figcaption" paddingX={3} paddingBottom={2} fontSize="10.5px" color="fg.subtle">
        {replayCaption({ replay, fromBoard: Boolean(entry.board) })}
      </Text>
    </Box>
  );
}
