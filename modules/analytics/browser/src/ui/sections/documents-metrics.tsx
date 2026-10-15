import { Card } from "@langwatch/design-system/card";
import { MetricTabs } from "@langwatch/design-system/metric-tabs";
import { Heading, HStack } from "@langwatch/design-system/primitives";
import { useMemo } from "react";

import { useTopUsedDocuments } from "../../behavior/use-analytics-documents.ts";
import { useFilterParams } from "../../behavior/use-filter-params.ts";
import { DocumentsCountsSummary, DocumentsCountsTable } from "./documents-counts-table.tsx";

/** The documents section has one metric, so there is no other tab to select. */
function keepOnlyTab() {}

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
        <Heading as="h2" size="sm" paddingTop={6} paddingBottom={2}>
          Documents
        </Heading>
      </HStack>
      <Card padding="lg">
        <MetricTabs
          value="total-documents"
          onValueChange={keepOnlyTab}
          label="Documents"
          items={[
            {
              value: "total-documents",
              label: "Total documents",
              figure: <DocumentsCountsSummary params={params} />,
              content: <DocumentsCountsTable params={params} />,
            },
          ]}
        />
      </Card>
    </>
  );
}
