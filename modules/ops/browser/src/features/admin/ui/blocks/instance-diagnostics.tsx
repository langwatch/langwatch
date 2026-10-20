import { Card } from "@langwatch/design-system/card";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Button, Text, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Download } from "lucide-react";

import { api } from "../../../../behavior/ops-api.ts";
import { useUpgradeDiagnosticsDownload } from "../../behavior/use-upgrade-diagnostics-download.ts";

const TRIGGER_LABELS = { automatic: "Automatically", operator: "By the operator" } as const;

/** The upgrade diagnostics an install sent, kept 30 days; the bundle opens on Download. */
export function InstanceDiagnostics({ instanceRowId }: { instanceRowId: string }) {
  const reports = api.selfHostedInstances.findDiagnostics.useQuery({ instanceRowId });
  const { download, downloadingId } = useUpgradeDiagnosticsDownload();
  const rows = reports.data ?? [];

  return (
    <Card title="Diagnostics" titleLevel={3} padding={rows.length === 0 ? "md" : "none"}>
      {reports.error ? (
        <HandledErrorAlert error={reports.error} fallbackTitle="Couldn't load the diagnostics" />
      ) : rows.length === 0 ? (
        <NoDataInfoBlock
          size="line"
          title={
            reports.isLoading
              ? "Loading diagnostics"
              : "This install has sent no upgrade diagnostics in the last 30 days."
          }
        />
      ) : (
        <ListTable variant="embedded" density="compact" scroll="x" scrollLabel="Diagnostics table">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Step</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Release</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Attempt</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Sent</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Received</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Expires</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Bundle</ListTable.ColumnHeader>
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {rows.map((report) => (
              <ListTable.Row key={report.id}>
                <ListTable.Cell>
                  <VStack align="start" gap={0}>
                    <Text textStyle="sm">{report.stepId}</Text>
                    {report.stepDescription ? (
                      <Text textStyle="xs" color="fg.muted">
                        {report.stepDescription}
                      </Text>
                    ) : null}
                  </VStack>
                </ListTable.Cell>
                <ListTable.Cell>{report.release ?? "not reported"}</ListTable.Cell>
                <ListTable.Cell>{report.attempt}</ListTable.Cell>
                <ListTable.Cell>{TRIGGER_LABELS[report.trigger]}</ListTable.Cell>
                <ListTable.Cell>
                  <FormattedDate value={report.receivedAt} />
                </ListTable.Cell>
                <ListTable.Cell>
                  <FormattedDate value={report.expiresAt} display="date" />
                </ListTable.Cell>
                <ListTable.Cell>
                  <Button
                    size="xs"
                    variant="outline"
                    loading={downloadingId === report.id}
                    onClick={() => download(report.id)}
                    aria-label={`Download the diagnostics of ${report.stepId}, attempt ${report.attempt}`}
                  >
                    <Download size={12} /> Download
                  </Button>
                </ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
      )}
    </Card>
  );
}
