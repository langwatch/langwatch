import { ListTable } from "@langwatch/design-system/list-table";
import type { EmptyNext } from "@langwatch/design-system/no-data-info-block";
import { Box, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import {
  type TopUsedDocumentsParams,
  useTopUsedDocuments,
} from "../../behavior/use-analytics-documents.ts";
import { useRetryFailedAnalytics } from "../../behavior/use-retry-failed-analytics.ts";
import { ChartErrorIndicator, ChartErrorState } from "../elements/chart-error-state.tsx";
import { SummaryMetricValue } from "../elements/summary-metric.tsx";

const DOCUMENTS_FALLBACK_TITLE = "Couldn't load documents";

const DOCUMENTS_NEXT: EmptyNext = [
  {
    kind: "docs",
    label: "How to capture RAG documents",
    href: "https://docs.langwatch.ai/integration/python/tutorials/capturing-rag",
  },
];

export const DocumentsCountsTable = ({ params }: { params?: TopUsedDocumentsParams } = {}) => {
  const documents = useTopUsedDocuments(params);
  const retryFailedAnalytics = useRetryFailedAnalytics();

  if (documents.failure && !documents.data) {
    return (
      <ChartErrorState
        error={documents.failure}
        onRetry={retryFailedAnalytics}
        isRetrying={documents.isRetrying}
        fallbackTitle={DOCUMENTS_FALLBACK_TITLE}
      />
    );
  }
  if (documents.isLoading) return <Box>Loading...</Box>;

  return (
    <VStack align="start" gap={4}>
      <Text fontSize="" paddingTop={4} fontWeight={600}>
        Top 10 most used documents
      </Text>
      <ListTable variant="embedded">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Document ID</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Snippet</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Usage count</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {documents.data?.topDocuments.length === 0 && (
            <ListTable.EmptyRow
              columns={3}
              state="empty"
              title="No documents found"
              description="Documents used as RAG context in your traces are ranked here."
              next={DOCUMENTS_NEXT}
            />
          )}

          {documents.data?.topDocuments.map((doc) => (
            <ListTable.Row key={doc.documentId}>
              <ListTable.Cell>
                <Tooltip content={doc.documentId}>
                  <Text lineClamp={1} wordBreak="break-all" display="block">
                    {doc.documentId}
                  </Text>
                </Tooltip>
              </ListTable.Cell>
              <ListTable.Cell>
                <Tooltip content={doc.content}>
                  <Text lineClamp={1} wordBreak="break-all" display="block">
                    {doc.content
                      ? doc.content.substring(0, 255) + (doc.content.length > 255 ? "..." : "")
                      : ""}
                  </Text>
                </Tooltip>
              </ListTable.Cell>
              <ListTable.Cell>{doc.count}</ListTable.Cell>
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
    </VStack>
  );
};

export const DocumentsCountsSummary = ({ params }: { params?: TopUsedDocumentsParams } = {}) => {
  const documents = useTopUsedDocuments(params);

  if (documents.failure && !documents.data) {
    return (
      <ChartErrorIndicator error={documents.failure} fallbackTitle={DOCUMENTS_FALLBACK_TITLE} />
    );
  }

  const count = documents.data?.totalUniqueDocuments;

  return <SummaryMetricValue current={count} />;
};
