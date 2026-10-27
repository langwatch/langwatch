import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
import { Table, Text } from "@langwatch/design-system/primitives";

import { formatDuration } from "../../../../model/ops-formatters.ts";
import {
  isImportedHistory,
  releaseName,
  runKindLabel,
  runOutcomeLabel,
} from "../../model/upgrade-labels.ts";
import type { UpgradeRunSummaryView } from "../../model/upgrade-view.ts";
import { UpgradeStatusBadge } from "../elements/upgrade-status-badge.tsx";

/** The Runs tab: the ledger's runs, newest first; a row opens the run drawer. */
export function UpgradeRuns({
  runs,
  onOpenRun,
}: {
  runs: readonly UpgradeRunSummaryView[];
  onOpenRun: (runId: string) => void;
}) {
  if (runs.length === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No release upgrade has run yet.
      </Text>
    );
  }
  return (
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      data-testid="upgrade-runs"
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Outcome</Table.ColumnHeader>
          <Table.ColumnHeader>Kind</Table.ColumnHeader>
          <Table.ColumnHeader>Release</Table.ColumnHeader>
          <Table.ColumnHeader>Started</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">Duration</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {runs.map((run) => (
          <Table.Row
            key={run.id}
            cursor="pointer"
            onClick={() => onOpenRun(run.id)}
            data-testid={`upgrade-run-${run.id}`}
          >
            <Table.Cell>
              <UpgradeStatusBadge label={runOutcomeLabel(run.outcome)} />
            </Table.Cell>
            <Table.Cell>{runKindLabel(run.kind)}</Table.Cell>
            <Table.Cell fontFamily="mono">
              {isImportedHistory(run) ? "" : releaseName(run.release)}
            </Table.Cell>
            <Table.Cell whiteSpace="nowrap">
              <FormattedDate value={run.startedAt} />
            </Table.Cell>
            <Table.Cell textAlign="end" whiteSpace="nowrap">
              {formatDuration(run.startedAt, run.finishedAt)}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}
