import {
  Box,
  Center,
  Link,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useFilterParams } from "../../hooks/useFilterParams";
import { api } from "../../utils/api";
import { SummaryMetricValue } from "./SummaryMetric";
import { ExternalLink } from "react-feather";
import { useDrawer } from "../CurrentDrawer";
import { Tooltip } from "../ui/tooltip";

export const FeedbacksTable = () => {
  const { filterParams, queryOpts } = useFilterParams();
  const feedbacks = api.analytics.feedbacks.useQuery(filterParams, queryOpts);
  const { openDrawer } = useDrawer();

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
              <Table.Cell colSpan={2}>
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
            const vote = event.metrics.find((metric) => metric.key === "vote")
              ?.value;
            const feedback = event.event_details.find(
              (detail) => detail.key === "feedback"
            )?.value;

            return (
              <Table.Row
                key={index}
                onClick={() => {
                  openDrawer("traceDetails", {
                    traceId: event.trace_id,
                  });
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
                    event.timestamps.started_at ?? event.timestamps.inserted_at
                  ).toLocaleString()}
                </Table.Cell>
                <Table.Cell>
                  <Center>
                    {event.trace_id && (
                      <Link
                        onClick={() => {
                          openDrawer("traceDetails", {
                            traceId: event.trace_id,
                          });
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
  const documents = api.analytics.topUsedDocuments.useQuery(
    filterParams,
    queryOpts
  );

  const count = documents.data?.totalUniqueDocuments;

  return <SummaryMetricValue current={count} />;
};
