import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Badge, Button, Text } from "@langwatch/design-system/primitives";
import type { OpsBlobSummary } from "@langwatch/ops-contract";

import { formatBytes } from "../../../../model/ops-formatters.ts";
import { formatLeaseLapse, formatTtl, sweepOutcomeLabel } from "../../model/blob-formatters.ts";

export function BlobRow({
  blob,
  canManage,
  onDelete,
}: {
  blob: OpsBlobSummary;
  canManage: boolean;
  onDelete: (blob: OpsBlobSummary) => void;
}) {
  const outcome = sweepOutcomeLabel(blob.sweepOutcome);

  return (
    <ListTable.Row>
      <ListTable.Cell>
        <InlineCode variant="neutral">{blob.projectId}</InlineCode>
      </ListTable.Cell>
      <ListTable.Cell>
        <InlineCode variant="neutral">{blob.hash}</InlineCode>
      </ListTable.Cell>
      <ListTable.Cell>{formatBytes(blob.sizeBytes)}</ListTable.Cell>
      <ListTable.Cell>{formatTtl(blob.ttlSeconds)}</ListTable.Cell>
      <ListTable.Cell>
        {blob.liveLeases > 0 ? (
          <Badge colorPalette="green" variant="subtle">
            {blob.liveLeases} job{blob.liveLeases === 1 ? "" : "s"}
          </Badge>
        ) : (
          <Badge colorPalette="gray" variant="subtle">
            Nothing
          </Badge>
        )}
      </ListTable.Cell>
      <ListTable.Cell>
        <Text textStyle="xs" color="fg.muted">
          {formatLeaseLapse(blob.earliestLeaseDeadlineMs)}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <Badge colorPalette={outcome.palette} variant="subtle">
          {outcome.label}
        </Badge>
      </ListTable.Cell>
      <ListTable.ActionCell>
        {canManage && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="ghost" size="sm" aria-label={`Actions for payload ${blob.hash}`}>
                <MoreVerticalIcon size={14} />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item value="delete" color="red.fg" onClick={() => onDelete(blob)}>
                Delete payload
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        )}
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}
