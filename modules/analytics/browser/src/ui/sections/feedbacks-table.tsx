import { ListTable } from "@langwatch/design-system/list-table";
import type { EmptyNext } from "@langwatch/design-system/no-data-info-block";
import { Box, Center, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Temporal } from "@langwatch/time";
import { ExternalLink } from "react-feather";

import { useAnalyticsFeedbacks } from "../../behavior/use-analytics-documents.ts";
import { useRetryFailedAnalytics } from "../../behavior/use-retry-failed-analytics.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { traceDetailsAddress } from "../../model/analytics-overlay-address.ts";
import { ChartErrorState } from "../elements/chart-error-state.tsx";

const FEEDBACK_NEXT: EmptyNext = [
  {
    kind: "docs",
    label: "How to collect feedback",
    href: "https://docs.langwatch.ai/user-events/thumbs-up-down",
  },
];

function voteGlyph(vote: number | null | undefined): string {
  if (vote === 1) return "👍";
  if (vote === -1) return "👎";

  return "-";
}

export const FeedbacksTable = () => {
  const feedbacks = useAnalyticsFeedbacks();
  const host = useAnalyticsHost();
  const retryFailedAnalytics = useRetryFailedAnalytics();
  const openTrace = (traceId: string) =>
    host.setQuery(traceDetailsAddress({ current: host.route().query, traceId }));

  if (feedbacks.isLoading) return <Box>Loading...</Box>;
  if (feedbacks.error && !feedbacks.data) {
    return (
      <ChartErrorState
        error={feedbacks.error}
        onRetry={retryFailedAnalytics}
        fallbackTitle="Couldn't load feedback"
      />
    );
  }

  return (
    <VStack align="start" gap={4}>
      <ListTable variant="embedded">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader width="48px" label="Vote" />
            <ListTable.ColumnHeader>Feedback</ListTable.ColumnHeader>
            <ListTable.ColumnHeader width="250px">Date</ListTable.ColumnHeader>
            <ListTable.ColumnHeader width="180px" align="center">
              Open Message
            </ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {feedbacks.data?.events.length === 0 && (
            <ListTable.EmptyRow
              columns={4}
              state="empty"
              title="No written feedbacks received yet"
              description="Thumbs up and down with a comment show up here."
              next={FEEDBACK_NEXT}
            />
          )}

          {feedbacks.data?.events.map((event, index) => {
            const vote = event.metrics?.find((metric) => metric.key === "vote")?.value;
            const feedback = event.event_details?.find(
              (detail) => detail.key === "feedback",
            )?.value;

            return (
              <ListTable.Row
                key={index}
                onActivate={() => {
                  openTrace(event.trace_id);
                }}
              >
                <ListTable.Cell align="center">{voteGlyph(vote)}</ListTable.Cell>
                <ListTable.Cell>
                  <Tooltip content={feedback}>
                    <Text lineClamp={1} wordBreak="break-all" display="block">
                      {feedback}
                    </Text>
                  </Tooltip>
                </ListTable.Cell>
                <ListTable.Cell>
                  {Temporal.Instant.fromEpochMilliseconds(
                    event.timestamps.started_at ?? event.timestamps.inserted_at,
                  )
                    .toZonedDateTimeISO(Temporal.Now.timeZoneId())
                    .toLocaleString()}
                </ListTable.Cell>
                <ListTable.Cell>
                  <Center>
                    {event.trace_id && (
                      <ListTable.RowAction
                        label="Open trace"
                        onActivate={() => {
                          openTrace(event.trace_id);
                        }}
                      >
                        <ExternalLink />
                      </ListTable.RowAction>
                    )}
                  </Center>
                </ListTable.Cell>
              </ListTable.Row>
            );
          })}
        </ListTable.Body>
      </ListTable>
    </VStack>
  );
};
