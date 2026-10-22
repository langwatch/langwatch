import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Megaphone } from "lucide-react";

import {
  SEVERITY_LABELS,
  SEVERITY_PALETTE,
  STATUS_LABELS,
  STATUS_PALETTE,
  type SelfHostedNoticeRow,
} from "../../model/self-hosted-notice.ts";
import { AdminDate, EmptyCell } from "../elements/admin-cells.tsx";

const COLUMN_COUNT = 7;

export function SelfHostedNoticesTable({
  notices,
  isLoading,
  isBusy,
  onEdit,
  onPublish,
  onWithdraw,
}: {
  notices: SelfHostedNoticeRow[];
  isLoading: boolean;
  isBusy: boolean;
  onEdit: (notice: SelfHostedNoticeRow) => void;
  onPublish: (notice: SelfHostedNoticeRow) => void;
  onWithdraw: (notice: SelfHostedNoticeRow) => void;
}) {
  return (
    <ListTable
      variant="embedded"
      density="compact"
      scroll="x"
      scrollLabel="Self-hosted notices table"
    >
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Severity</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Title</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Fixed in</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Published</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Stops showing</ListTable.ColumnHeader>
          <ListTable.ColumnHeader width="fit" label="Actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {notices.length === 0 && !isLoading ? <EmptyRow /> : null}
        {notices.map((notice) => (
          <ListTable.Row key={notice.id}>
            <ListTable.Cell>
              <Badge colorPalette={SEVERITY_PALETTE[notice.severity]}>
                {SEVERITY_LABELS[notice.severity]}
              </Badge>
            </ListTable.Cell>
            <ListTable.Cell>
              <Text>{notice.title}</Text>
            </ListTable.Cell>
            <ListTable.Cell>
              {notice.fixedIn ? <Text>{notice.fixedIn}</Text> : <EmptyCell />}
            </ListTable.Cell>
            <ListTable.Cell>
              <Badge colorPalette={STATUS_PALETTE[notice.status]}>
                {STATUS_LABELS[notice.status]}
              </Badge>
            </ListTable.Cell>
            <ListTable.Cell>
              {notice.publishedAt ? (
                <VStack align="start" gap={0}>
                  <AdminDate value={notice.publishedAt} display="datetime" />
                  {notice.publishedBy ? (
                    <Text textStyle="xs" color="fg.muted">
                      by {notice.publishedBy}
                    </Text>
                  ) : null}
                </VStack>
              ) : (
                <EmptyCell />
              )}
            </ListTable.Cell>
            <ListTable.Cell>
              {notice.expiresAt ? (
                <AdminDate value={notice.expiresAt} />
              ) : (
                <EmptyCell>Never</EmptyCell>
              )}
            </ListTable.Cell>
            <ListTable.Cell>
              <HStack gap={2} justify="end">
                <Button size="xs" variant="ghost" onClick={() => onEdit(notice)}>
                  Edit
                </Button>
                {notice.status === "published" ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => onWithdraw(notice)}
                  >
                    Withdraw
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() => onPublish(notice)}
                  >
                    Publish
                  </Button>
                )}
              </HStack>
            </ListTable.Cell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

function EmptyRow() {
  return (
    <ListTable.SpanRow columns={COLUMN_COUNT}>
      <NoDataInfoBlock
        icon={<Megaphone />}
        title="No notices yet"
        description="A published notice shows on every self-hosted install after its next daily report."
      />
    </ListTable.SpanRow>
  );
}
