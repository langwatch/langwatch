import {
  Box,
  Card,
  Heading,
  HStack,
  Tabs,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { useMemo } from "react";

import { useTopUsedDocuments } from "../../behavior/use-analytics-documents.ts";
import { useFilterParams } from "../../behavior/use-filter-params.ts";
import { DocumentsCountsSummary, DocumentsCountsTable } from "./documents-counts-table.tsx";

/**
 * The Documents section of the analytics overview. It hides when the window has no
 * documents, and stays up when the query failed so its panels can show the error with a
 * Retry.
 */
export function DocumentsMetrics() {
  const { filterParams, queryOpts } = useFilterParams();
  // One window for the section and both its panels, so they share one cached request.
  const params = useMemo(() => ({ filterParams, queryOpts }), [filterParams, queryOpts]);
  const documents = useTopUsedDocuments(params);

  const count = documents.data?.totalUniqueDocuments;

  // A failed query says nothing about whether there are documents, so the
  // section stays up, retries included, and its panels show the error with a
  // Retry.
  if (!documents.failure && !count) {
    return null;
  }

  return (
    <>
      <HStack width="full" align="top">
        <Heading as="h2" size="md" paddingTop={6} paddingBottom={2}>
          Documents
        </Heading>
      </HStack>
      <Card.Root width="full">
        <Card.Body>
          <Tabs.Root variant="plain" defaultValue="total-documents">
            <Tabs.List gap={12}>
              <Tabs.Trigger value="total-documents" paddingX={0} paddingBottom={4}>
                <VStack align="start">
                  <Text color="fg">Total documents</Text>
                  <Box textStyle="2xl" color="fg" fontWeight="bold">
                    <DocumentsCountsSummary params={params} />
                  </Box>
                </VStack>
              </Tabs.Trigger>
              <Tabs.Indicator
                mt="-1.5px"
                height="4px"
                bg="orange.400"
                borderRadius="1px"
                bottom={0}
              />
            </Tabs.List>
            <Tabs.Content value="total-documents">
              <DocumentsCountsTable params={params} />
            </Tabs.Content>
          </Tabs.Root>
        </Card.Body>
      </Card.Root>
    </>
  );
}
