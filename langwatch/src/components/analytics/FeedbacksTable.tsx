import {
  Box,
  Center,
  HStack,
  Link,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
} from "@chakra-ui/react";
import { useFilterParams } from "../../hooks/useFilterParams";
import { api } from "../../utils/api";
import { SummaryMetricValue } from "./SummaryMetric";
import { ExternalLink } from "react-feather";
import { useDrawer } from "../CurrentDrawer";

export const FeedbacksTable = () => {
  const { filterParams, queryOpts } = useFilterParams();
  const feedbacks = api.analytics.feedbacks.useQuery(filterParams, queryOpts);
  const { openDrawer } = useDrawer();

  if (feedbacks.isLoading) return <Box>Loading...</Box>;
  if (feedbacks.error) return <Box>An error occurred</Box>;

  return (
    <VStack align="start" spacing={4}>
      <Table variant="simple" padding={0} margin={0}>
        <Thead>
          <Tr>
            <Th width="48px" paddingLeft={0}></Th>
            <Th>Feedback</Th>
            <Th width="250px">Date</Th>
            <Th width="180px" textAlign="center">
              Open Message
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {feedbacks.data?.events.length === 0 && (
            <Tr>
              <Td colSpan={2}>
                No written feedbacks received yet, check out our{" "}
                <a
                  href="https://docs.langwatch.ai/docs/user-events/thumbs-up-down"
                  target="_blank"
                  style={{ textDecoration: "underline" }}
                >
                  docs
                </a>{" "}
                on how to integrate
              </Td>
            </Tr>
          )}

          {feedbacks.data?.events.map((event, index) => {
            const vote = event.metrics.find((metric) => metric.key === "vote")
              ?.value;
            const feedback = event.event_details.find(
              (detail) => detail.key === "feedback"
            )?.value;

            return (
              <Tr
                key={index}
                onClick={() => {
                  openDrawer("traceDetails", {
                    traceId: event.trace_id!,
                  });
                }}
                cursor="pointer"
              >
                <Td paddingLeft={0} textAlign="center" paddingRight="0">
                  {vote === 1 ? "👍" : vote === -1 ? "👎" : "-"}
                </Td>
                <Td>
                  <Tooltip label={feedback}>
                    <Text noOfLines={1} wordBreak="break-all" display="block">
                      {feedback}
                    </Text>
                  </Tooltip>
                </Td>
                <Td>
                  {new Date(
                    event.timestamps.started_at ?? event.timestamps.inserted_at
                  ).toLocaleString()}
                </Td>
                <Td>
                  <Center>
                    {event.trace_id && (
                      <Link
                        onClick={() => {
                          openDrawer("traceDetails", {
                            traceId: event.trace_id!,
                          });
                        }}
                      >
                        <ExternalLink />
                      </Link>
                    )}
                  </Center>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
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
