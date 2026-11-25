/** What changed since a version: counts, column changes, and the added, removed, changed rows. */

import { ListTable } from "@langwatch/design-system/list-table";
import { Alert, Badge, Heading, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import {
  changedColumnNames,
  changedRowLabel,
  formatVersionCellValue,
  rowCountLabel,
  versionColumnNames,
  type DatasetVersionChangedRow,
  type DatasetVersionRowItem,
} from "../../model/dataset-version-history.ts";
import { DatasetVersionRowsTable } from "./dataset-version-rows-table.tsx";

export type DatasetVersionComparisonView = {
  version: number;
  columns: { added: string[]; removed: string[] };
  counts: { added: number; removed: number; changed: number; unchanged: number };
  added: DatasetVersionRowItem[];
  removed: DatasetVersionRowItem[];
  changed: DatasetVersionChangedRow[];
  truncated: boolean;
};

export function DatasetVersionComparison({
  comparison,
  columnOrder,
}: {
  comparison: DatasetVersionComparisonView;
  /** The version's own columns, so row tables read in the dataset's column order. */
  columnOrder: readonly { name: string }[];
}) {
  const { version, columns, counts } = comparison;
  const nothingChanged =
    counts.added + counts.removed + counts.changed === 0 &&
    columns.added.length + columns.removed.length === 0;

  return (
    <VStack align="stretch" gap={6}>
      <HStack gap={2} flexWrap="wrap" aria-label="Summary">
        <Badge colorPalette="green">{counts.added.toLocaleString("en-GB")} added</Badge>
        <Badge colorPalette="red">{counts.removed.toLocaleString("en-GB")} removed</Badge>
        <Badge colorPalette="orange">{counts.changed.toLocaleString("en-GB")} changed</Badge>
        <Badge variant="subtle">{counts.unchanged.toLocaleString("en-GB")} unchanged</Badge>
      </HStack>

      {nothingChanged && (
        <Text color="fg.muted">Version {version} matches the current content.</Text>
      )}

      {comparison.truncated && (
        <Alert.Root status="info" size="sm">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Only the first rows of each kind are listed</Alert.Title>
            <Alert.Description>The counts above cover every row.</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {(columns.added.length > 0 || columns.removed.length > 0) && (
        <VStack align="stretch" gap={1}>
          <Heading as="h3" size="sm">
            Columns
          </Heading>
          {columns.added.length > 0 && (
            <Text fontSize="sm">
              Added since version {version}: {columns.added.join(", ")}
            </Text>
          )}
          {columns.removed.length > 0 && (
            <Text fontSize="sm">
              Removed since version {version}: {columns.removed.join(", ")}
            </Text>
          )}
        </VStack>
      )}

      {comparison.added.length > 0 && (
        <RowsSection
          columnOrder={columnOrder}
          title={`Added since version ${version}`}
          tableLabel="Added rows"
          count={counts.added}
          rows={comparison.added}
        />
      )}
      {comparison.removed.length > 0 && (
        <RowsSection
          columnOrder={columnOrder}
          title={`Removed since version ${version}`}
          tableLabel="Removed rows"
          count={counts.removed}
          rows={comparison.removed}
        />
      )}
      {comparison.changed.length > 0 && (
        <ChangedSection version={version} count={counts.changed} rows={comparison.changed} />
      )}
    </VStack>
  );
}

function RowsSection({
  title,
  tableLabel,
  count,
  rows,
  columnOrder,
}: {
  columnOrder: readonly { name: string }[];
  title: string;
  tableLabel: string;
  count: number;
  rows: DatasetVersionRowItem[];
}) {
  return (
    <VStack as="section" align="stretch" gap={2} aria-label={title}>
      <Heading as="h3" size="sm">
        {title} ({rowCountLabel(count)})
      </Heading>
      <DatasetVersionRowsTable
        label={tableLabel}
        columns={versionColumnNames({ columns: columnOrder, rows })}
        rows={rows}
      />
    </VStack>
  );
}

function ChangedSection({
  version,
  count,
  rows,
}: {
  version: number;
  count: number;
  rows: DatasetVersionChangedRow[];
}) {
  const title = `Changed since version ${version}`;
  return (
    <VStack as="section" align="stretch" gap={2} aria-label={title}>
      <Heading as="h3" size="sm">
        {title} ({rowCountLabel(count)})
      </Heading>
      <ListTable density="compact" scroll="x" scrollLabel="Changed values">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Column</ListTable.ColumnHeader>
            <ListTable.ColumnHeader minWidth="160px">In version {version}</ListTable.ColumnHeader>
            <ListTable.ColumnHeader minWidth="160px">Now</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {rows.flatMap((row) => [
            <ListTable.SpanRow key={row.id} columns={3} band>
              <Text fontSize="xs" fontWeight="medium" color="fg.muted" paddingX={3} paddingY={1}>
                {changedRowLabel(row)}
              </Text>
            </ListTable.SpanRow>,
            ...changedColumnNames(row).map((column) => (
              <ListTable.Row key={`${row.id}:${column}`}>
                <ListTable.Cell valign="top" nowrap>
                  {column}
                </ListTable.Cell>
                <ListTable.Cell valign="top">
                  <CellValue value={row.before[column]} />
                </ListTable.Cell>
                <ListTable.Cell valign="top">
                  <CellValue value={row.after[column]} />
                </ListTable.Cell>
              </ListTable.Row>
            )),
          ])}
        </ListTable.Body>
      </ListTable>
    </VStack>
  );
}

function CellValue({ value }: { value: unknown }) {
  const text = formatVersionCellValue(value);
  if (!text) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        Empty
      </Text>
    );
  }
  return (
    <Text fontSize="sm" lineClamp={3} overflowWrap="anywhere">
      {text}
    </Text>
  );
}
