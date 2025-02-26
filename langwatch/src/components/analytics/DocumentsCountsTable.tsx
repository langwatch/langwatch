import {
  Box,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useFilterParams } from "../../hooks/useFilterParams";
import { api } from "../../utils/api";
import { SummaryMetricValue } from "./SummaryMetric";
import { Tooltip } from "../ui/tooltip";

export const DocumentsCountsTable = () => {
  const { filterParams, queryOpts } = useFilterParams();
  const documents = api.analytics.topUsedDocuments.useQuery(
    filterParams,
    queryOpts
  );

  if (documents.isLoading) return <Box>Loading...</Box>;
  if (documents.error) return <Box>An error occurred</Box>;

  return (
    <VStack align="start" gap={4}>
      <Text fontSize="" paddingTop={4} fontWeight={600}>
        Top 10 most used documents
      </Text>
      <Table.Root variant="line" padding={0} margin={0}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader paddingLeft={0}>Document ID</Table.ColumnHeader>
            <Table.ColumnHeader>Snippet</Table.ColumnHeader>
            <Table.ColumnHeader>Usage Count</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {documents.data?.topDocuments.length === 0 && (
            <Table.Row>
              <Table.Cell colSpan={2}>No documents found</Table.Cell>
            </Table.Row>
          )}

          {documents.data?.topDocuments.map((doc) => (
            <Table.Row key={doc.documentId}>
              <Table.Cell paddingLeft={0}>
                <Tooltip content={doc.documentId}>
                  <Text lineClamp={1} wordBreak="break-all" display="block">
                    {doc.documentId}
                  </Text>
                </Tooltip>
              </Table.Cell>
              <Table.Cell>
                <Tooltip content={doc.content}>
                  <Text lineClamp={1} wordBreak="break-all" display="block">
                    {doc.content
                      ? doc.content.substring(0, 255) +
                        (doc.content.length > 255 ? "..." : "")
                      : ""}
                  </Text>
                </Tooltip>
              </Table.Cell>
              <Table.Cell>{doc.count}</Table.Cell>
            </Table.Row>
          ))}
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
