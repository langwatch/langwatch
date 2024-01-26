import {
  Box,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from "@chakra-ui/react";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { api } from "../../utils/api";
import { SummaryMetricValue } from "./SummaryMetric";

export const DocumentsCountsTable = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const documents = api.analytics.topUsedDocuments.useQuery(
    analyticsParams,
    queryOpts
  );

  if (documents.isLoading) return <Box>Loading...</Box>;
  if (documents.error) return <Box>An error occurred</Box>;

  return (
    <VStack align="start" spacing={4}>
      <Text fontSize="lg" paddingTop={4}>
        Top 10 most used documents
      </Text>
      <Table variant="simple" padding={0} margin={0}>
        <Thead>
          <Tr>
            <Th paddingLeft={0}>Document ID</Th>
            <Th>Snippet</Th>
            <Th>Usage Count</Th>
          </Tr>
        </Thead>
        <Tbody>
          {documents.data?.topDocuments.length === 0 && (
            <Tr>
              <Td colSpan={2}>No documents found</Td>
            </Tr>
          )}
          {documents.data?.topDocuments.map((doc) => (
            <Tr key={doc.documentId}>
              <Td paddingLeft={0}>{doc.documentId}</Td>
              <Td>
                {doc.content.substring(0, 255) +
                  (doc.content.length > 255 ? "..." : "")}
              </Td>
              <Td>{doc.count}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </VStack>
  );
};

export const DocumentsCountsSummary = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const documents = api.analytics.topUsedDocuments.useQuery(
    analyticsParams,
    queryOpts
  );

  const count = documents.data?.totalUniqueDocuments;

  return <SummaryMetricValue current={count} />;
};
