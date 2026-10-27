/** The history drawer's list of versions, newest first, each with its row actions. */

import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { FlaskConical, MoreVertical } from "lucide-react";

import {
  rowCountLabel,
  versionTitle,
  versionTriggerLabel,
  versionUsageLabel,
  type DatasetVersionListItem,
} from "../../model/dataset-version-history.ts";

export type DatasetVersionListProps = {
  versions: readonly DatasetVersionListItem[];
  authorLabel: (version: DatasetVersionListItem) => string;
  /** Why this version cannot be restored, or null when it can. */
  restoreBlockedReason: (version: DatasetVersionListItem) => string | null;
  onView: (version: DatasetVersionListItem) => void;
  onCompare: (version: DatasetVersionListItem) => void;
  onRestore: (version: DatasetVersionListItem) => void;
};

export function DatasetVersionList({
  versions,
  authorLabel,
  restoreBlockedReason,
  onView,
  onCompare,
  onRestore,
}: DatasetVersionListProps) {
  return (
    <ListTable density="compact" scroll="x" scrollLabel="Versions">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Version</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Saved by</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>When</ListTable.ColumnHeader>
          <ListTable.ColumnHeader align="end">Rows</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {versions.map((version, index) => {
          const usage = versionUsageLabel(version);
          const blockedReason = restoreBlockedReason(version);
          return (
            <ListTable.Row
              key={version.id}
              data-testid={`dataset-version-${version.version}`}
              onActivate={() => onView(version)}
            >
              <ListTable.Cell>
                <VStack align="start" gap={1}>
                  <Text fontSize="sm" fontWeight="medium">
                    {versionTitle(version)}
                  </Text>
                  <HStack gap={1} flexWrap="wrap">
                    {index === 0 && (
                      <Badge size="sm" colorPalette="green">
                        Latest
                      </Badge>
                    )}
                    <Badge size="sm" variant="subtle">
                      {versionTriggerLabel(version)}
                    </Badge>
                    {usage && (
                      <Tooltip content="Experiment runs that read this version keep it from being cleaned up.">
                        <Badge size="sm" variant="outline">
                          <FlaskConical size={12} aria-hidden /> {usage}
                        </Badge>
                      </Tooltip>
                    )}
                  </HStack>
                </VStack>
              </ListTable.Cell>
              <ListTable.Cell tone="muted">{authorLabel(version)}</ListTable.Cell>
              <ListTable.Cell tone="muted" nowrap>
                <FormattedDate value={version.createdAt} display="relative" />
              </ListTable.Cell>
              <ListTable.Cell numeric tone="muted">
                {rowCountLabel(version.rowCount)}
              </ListTable.Cell>
              <ListTable.ActionCell>
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Actions for version ${version.version}`}
                    >
                      <MoreVertical size={14} />
                    </Button>
                  </Menu.Trigger>
                  <Menu.Content>
                    <Menu.Item value="view" onClick={() => onView(version)}>
                      View rows
                    </Menu.Item>
                    <Menu.Item value="compare" onClick={() => onCompare(version)}>
                      Compare with current
                    </Menu.Item>
                    <Menu.Item
                      value="restore"
                      disabled={blockedReason !== null}
                      title={blockedReason ?? undefined}
                      onClick={() => onRestore(version)}
                    >
                      Restore this version
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Root>
              </ListTable.ActionCell>
            </ListTable.Row>
          );
        })}
      </ListTable.Body>
    </ListTable>
  );
}
