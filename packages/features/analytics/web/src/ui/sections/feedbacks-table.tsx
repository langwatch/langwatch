import { Box, Center, Link, Table, Text, VStack } from "@chakra-ui/react";
import { ExternalLink } from "react-feather";
import { useAnalyticsHost } from "../../model/analytics-host";
import { traceDetailsAddress } from "../../model/analytics-overlay-address";
import { useFilterParams } from "../../behavior/use-filter-params";
import { analyticsApi } from "../../behavior/analytics-api";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { SummaryMetricValue } from "../elements/summary-metric";

export const FeedbacksTable = () => {
  const { filterParams, queryOpts } = useFilterParams();
  const feedbacks = analyticsApi.analytics.feedbacks.useQuery(filterParams, queryOpts);
  const host = useAnalyticsHost();
  const openTrace = (traceId: string) =>
    host.setQuery(traceDetailsAddress({ current: host.route().query, traceId }));

  if (feedbacks.isLoading) return <Box>Loading...</Box>;
  if (feedbacks.error) return <Box>An error occurred</Box>;

  return (
    <VStack align="start" gap={4}>
      <Table.Root variant="line" padding={0} margin={0}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader width="48px" paddingLeft={0}></Table.ColumnHeader>
            <Table.ColumnHeader>Feedback</Table.ColumnHeader>
            <Table.ColumnHeader width="250px">Date</Table.ColumnHeader>
            <Table.ColumnHeader width="180px" textAlign="center">
              Open Message
            </Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {feedbacks.data?.events.length === 0 && (
            <Table.Row>
              <Table.Cell colSpan={4}>
                No written feedbacks received yet, check out our{" "}
                <a
                  href="https://docs.langwatch.ai/docs/user-events/thumbs-up-down"
                  target="_blank"
                  style={{ textDecoration: "underline" }}
                >
                  docs
                </a>{" "}
                on how to integrate
              </Table.Cell>
            </Table.Row>
          )}

          {feedbacks.data?.events.map((event, index) => {
            const vote = event.metrics?.find((metric) => metric.key === "vote")?.value;
            const feedback = event.event_details?.find(
              (detail) => detail.key === "feedback",
            )?.value;

            return (
              <Table.Row
                key={index}
                onClick={() => {
                  openTrace(event.trace_id);
                }}
                cursor="pointer"
              >
                <Table.Cell paddingLeft={0} textAlign="center" paddingRight="0">
                  {vote === 1 ? "👍" : vote === -1 ? "👎" : "-"}
                </Table.Cell>
                <Table.Cell>
                  <Tooltip content={feedback}>
                    <Text lineClamp={1} wordBreak="break-all" display="block">
                      {feedback}
                    </Text>
                  </Tooltip>
                </Table.Cell>
                <Table.Cell>
                  {new Date(
                    event.timestamps.started_at ?? event.timestamps.inserted_at,
                  ).toLocaleString()}
                </Table.Cell>
                <Table.Cell>
                  <Center>
                    {event.trace_id && (
                      <Link
                        onClick={() => {
                          openTrace(event.trace_id);
                        }}
                      >
                        <ExternalLink />
                      </Link>
                    )}
                  </Center>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </VStack>
  );
};

export const DocumentsCountsSummary = () => {
  const { filterParams, queryOpts } = useFilterParams();
  const documents = analyticsApi.analytics.topUsedDocuments.useQuery(filterParams, queryOpts);

  const count = documents.data?.totalUniqueDocuments;

  return <SummaryMetricValue current={count} />;
};
