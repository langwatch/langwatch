import { Box, Table, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import {
  type TopUsedDocumentsParams,
  useTopUsedDocuments,
} from "../../behavior/use-analytics-documents.ts";
import { useRetryFailedAnalytics } from "../../behavior/use-retry-failed-analytics.ts";
import { ChartErrorIndicator, ChartErrorState } from "../elements/chart-error-state.tsx";
import { SummaryMetricValue } from "../elements/summary-metric.tsx";

const DOCUMENTS_FALLBACK_TITLE = "Couldn't load documents";

export const DocumentsCountsTable = ({ params }: { params?: TopUsedDocumentsParams } = {}) => {
  const documents = useTopUsedDocuments(params);
  const retryFailedAnalytics = useRetryFailedAnalytics();

  if (documents.isLoading) return <Box>Loading...</Box>;
  if (documents.error && !documents.data) {
    return (
      <ChartErrorState
        error={documents.error}
        onRetry={retryFailedAnalytics}
        fallbackTitle={DOCUMENTS_FALLBACK_TITLE}
      />
    );
  }

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
                      ? doc.content.substring(0, 255) + (doc.content.length > 255 ? "..." : "")
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

export const DocumentsCountsSummary = ({ params }: { params?: TopUsedDocumentsParams } = {}) => {
  const documents = useTopUsedDocuments(params);

  if (documents.error && !documents.data) {
    return <ChartErrorIndicator error={documents.error} fallbackTitle={DOCUMENTS_FALLBACK_TITLE} />;
  }

  const count = documents.data?.totalUniqueDocuments;

  return <SummaryMetricValue current={count} />;
};
