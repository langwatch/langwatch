import { Badge, Button, Table, Text } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";

import { formatBytes } from "~/components/ops/shared/formatters";
import { Menu } from "~/components/ui/menu";
import type { OpsBlobSummary } from "~/server/app-layer/ops/types";

import {
  formatLeaseLapse,
  formatTtl,
  sweepOutcomeLabel,
} from "./blobFormatters";

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
    <Table.Row>
      <Table.Cell>
        <Text textStyle="xs" fontFamily="mono">
          {blob.projectId}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" fontFamily="mono">
          {blob.hash}
        </Text>
      </Table.Cell>
      <Table.Cell>{formatBytes(blob.sizeBytes)}</Table.Cell>
      <Table.Cell>{formatTtl(blob.ttlSeconds)}</Table.Cell>
      <Table.Cell>
        {blob.liveLeases > 0 ? (
          <Badge colorPalette="green" variant="subtle">
            {blob.liveLeases} job{blob.liveLeases === 1 ? "" : "s"}
          </Badge>
        ) : (
          <Badge colorPalette="gray" variant="subtle">
            Nothing
          </Badge>
        )}
      </Table.Cell>
      <Table.Cell>
        <Text textStyle="xs" color="fg.muted">
          {formatLeaseLapse(blob.earliestLeaseDeadlineMs)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Badge colorPalette={outcome.palette} variant="subtle">
          {outcome.label}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        {canManage && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                variant="ghost"
                size="2xs"
                aria-label={`Actions for payload ${blob.hash}`}
              >
                <MoreVertical size={14} />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item
                value="delete"
                color="red.500"
                onClick={() => onDelete(blob)}
              >
                Delete payload
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        )}
      </Table.Cell>
    </Table.Row>
  );
}
