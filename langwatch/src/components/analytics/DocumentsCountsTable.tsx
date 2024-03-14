import {
  Box,
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

export const DocumentsCountsTable = () => {
  const { filterParams, queryOpts } = useFilterParams();
  const documents = api.analytics.topUsedDocuments.useQuery(
    filterParams,
    queryOpts
  );

  if (documents.isLoading) return <Box>Loading...</Box>;
  if (documents.error) return <Box>An error occurred</Box>;

  return (
    <VStack align="start" spacing={4}>
      <Text fontSize="" paddingTop={4} fontWeight={600}>
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
              <Td paddingLeft={0}>
                <Tooltip label={doc.documentId}>
                  <Text noOfLines={1} wordBreak="break-all" display="block">
                    {doc.documentId}
                  </Text>
                </Tooltip>
              </Td>
              <Td>
                <Tooltip label={doc.content}>
                  <Text noOfLines={1} wordBreak="break-all" display="block">
                    {doc.content
                      ? doc.content.substring(0, 255) +
                        (doc.content.length > 255 ? "..." : "")
                      : ""}
                  </Text>
                </Tooltip>
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
  const { filterParams, queryOpts } = useFilterParams();
  const documents = api.analytics.topUsedDocuments.useQuery(
    filterParams,
    queryOpts
  );

  const count = documents.data?.totalUniqueDocuments;

  return <SummaryMetricValue current={count} />;
};
