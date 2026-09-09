// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  Badge,
  Box,
  Button,
  HStack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Source } from "@ee/governance/dashboard/pages/ingestionSourceForms";
import { MoreVertical, Pencil, RotateCw, Trash2 } from "lucide-react";
import { ListTable } from "~/components/ui/ListTable";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { shortPullCadence } from "../logic/pullCadence";
import { sourceBadge } from "../logic/sourceHealthDisplay";
import {
  groupForMode,
  modeForSourceType,
  needsIngestSecret,
  PROTOCOL_LABEL,
  SOURCE_TYPE_LABEL,
  type SourceGroup,
  type SourceType,
  SourceTypeIconGlyph,
} from "./ingestionSourceCatalog";

/**
 * The configured ingestion sources as one table. Delivery (real-time or
 * scheduled) is a column rather than two sections, so the fleet reads
 * top to bottom: real-time sources first, then scheduled, each group by
 * name. Every per-row action lives in the trailing overflow menu
 * (dev/docs/best_practices/row-actions-overflow-menu.md).
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */

const DELIVERY_LABEL: Record<SourceGroup, string> = {
  realtime: "Real-time",
  scheduled: "Scheduled",
};

/**
 * How long ago, in words.
 *
 * Units are spelled out. "23m ago" saves a few pixels and costs the reader a
 * guess — minutes or months — in a column whose whole job is to say whether
 * anything is still coming in.
 */
export function fmtRelative(date: Date | string | null): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  const time = d.getTime();
  // An unparsable string gives NaN, and every `<` below is false against NaN,
  // so the unguarded version fell through to the days branch and printed
  // "NaN days ago" in the column that says whether data is still arriving.
  if (Number.isNaN(time)) return "-";
  // A source whose clock runs ahead of this browser's would otherwise read
  // "-3 seconds ago". The honest answer to "how long ago" for a future
  // timestamp is "just now".
  const diffMs = Math.max(0, Date.now() - time);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${plural(sec, "second")} ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${plural(min, "minute")} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${plural(hr, "hour")} ago`;
  const days = Math.floor(hr / 24);
  return `${plural(days, "day")} ago`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function deliveryFor(source: Source): SourceGroup {
  return groupForMode(
    modeForSourceType({
      sourceType: (source.sourceType ?? "otel_generic") as SourceType,
    }),
  );
}

/** Real-time sources first, then scheduled; by name within each. */
export function sortSourcesForTable(sources: readonly Source[]): Source[] {
  const rank: Record<SourceGroup, number> = { realtime: 0, scheduled: 1 };
  return [...sources].sort((a, b) => {
    const byDelivery = rank[deliveryFor(a)] - rank[deliveryFor(b)];
    if (byDelivery !== 0) return byDelivery;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The fleet itself.
 *
 * A "Connectors · N sources · N active" heading used to sit above it. Both of
 * its figures moved into the Inventory page's resume strip, above the tab
 * strip, where they sit beside the other two panes' counts and a reader gets
 * them without opening this pane. Saying them twice on one screen is what the
 * strip was added to stop.
 */
export function IngestionSourcesTable({
  isSample = false,
  sources,
  canManage,
  rotatingId,
  archivingId,
  onEdit,
  onRotate,
  onArchive,
}: {
  isSample?: boolean;
  sources: readonly Source[];
  canManage: boolean;
  rotatingId: string | null;
  archivingId: string | null;
  onEdit: (id: string) => void;
  onRotate: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  return (
    <ListTable size="sm" containerProps={{ overflowX: "auto" }}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Source</Table.ColumnHeader>
          <Table.ColumnHeader>Protocol</Table.ColumnHeader>
          <Table.ColumnHeader>Delivery</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          {/* "Data last arrived", not "last event". `lastEventAt` is stamped
              when a pull DELIVERED something, so this answers "is anything
              still coming in" — the question a list of sources is read for.
              The source's own page shows the other number, the time written
              on the newest event, and the two are routinely hours apart
              because a daily report is stamped at the start of its day. One
              label for both was the whole confusion. */}
          <Table.ColumnHeader>Data last arrived</Table.ColumnHeader>
          {canManage && <Table.ColumnHeader width="1%" aria-label="Actions" />}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {sortSourcesForTable(sources).map((source) => (
          <SourceTableRow
            key={source.id}
            source={source}
            isSample={isSample}
            canManage={canManage}
            isPendingRotate={rotatingId === source.id}
            isPendingArchive={archivingId === source.id}
            onEdit={() => onEdit(source.id)}
            onRotate={() => onRotate(source.id)}
            onArchive={() => onArchive(source.id)}
          />
        ))}
      </Table.Body>
    </ListTable>
  );
}

function SourceTableRow({
  isSample,
  source,
  canManage,
  isPendingRotate,
  isPendingArchive,
  onEdit,
  onRotate,
  onArchive,
}: {
  isSample: boolean;
  source: Source;
  canManage: boolean;
  isPendingRotate: boolean;
  isPendingArchive: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onArchive: () => void;
}) {
  const sourceType = source.sourceType as SourceType;
  // Health wins over configured status (a source whose last runs all failed
  // is "Pulls failing", not "Active"); see sourceHealthDisplay.
  const status = sourceBadge({
    status: source.status,
    errorCount: source.errorCount,
  });
  const StatusIcon = status.icon;
  const typeLabel = SOURCE_TYPE_LABEL[sourceType] ?? source.sourceType;
  const mode = modeForSourceType({ sourceType });
  const delivery = deliveryFor(source);
  const cadence = shortPullCadence(source.pullSchedule);
  const hasSecret = needsIngestSecret({ sourceType });
  return (
    <Table.Row data-testid={`source-row-${source.id}`}>
      <Table.Cell>
        <HStack gap={3} alignItems="center">
          <SourceTypeIconGlyph sourceType={sourceType} size="20px" />
          <VStack align="start" gap={0} minWidth={0}>
            {isSample ? (
              <Text fontSize="sm" fontWeight="semibold" lineClamp={1}>
                {source.name}
              </Text>
            ) : (
              <Link
                href={`/governance/inventory/${source.id}`}
                color="fg"
                _hover={{ color: "orange.600" }}
              >
                <Text fontSize="sm" fontWeight="semibold" lineClamp={1}>
                  {source.name}
                </Text>
              </Link>
            )}
            {/* The type sits under the name to say what a source the admin
                named "Anthropic spend" actually is. A source named after its
                own type has nothing left to explain, so the line is dropped
                rather than printed twice. */}
            {typeLabel !== source.name && (
              <Text fontSize="xs" color="fg.muted">
                {typeLabel}
              </Text>
            )}
          </VStack>
        </HStack>
      </Table.Cell>
      <Table.Cell>
        <VStack align="start" gap={1}>
          <Badge size="sm" variant="outline">
            {PROTOCOL_LABEL[mode]}
          </Badge>
          {cadence && (
            <Text fontSize="xs" color="fg.muted">
              {cadence}
            </Text>
          )}
        </VStack>
      </Table.Cell>
      <Table.Cell>
        <Badge
          size="sm"
          variant="surface"
          colorPalette={delivery === "realtime" ? "blue" : "gray"}
        >
          {DELIVERY_LABEL[delivery]}
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <HStack gap={1}>
          <Box color={status.color} display="flex">
            <StatusIcon size={14} />
          </Box>
          <Text fontSize="sm">{status.label}</Text>
        </HStack>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm" color="fg.muted" whiteSpace="nowrap">
          {fmtRelative(source.lastEventAt ?? null)}
        </Text>
      </Table.Cell>
      {canManage && (
        <Table.Cell>
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Actions for ${source.name}`}
                loading={isPendingRotate || isPendingArchive}
              >
                <MoreVertical size={14} />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item
                value="edit"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil size={14} /> Edit
              </Menu.Item>
              {hasSecret && (
                <Menu.Item
                  value="rotate"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRotate();
                  }}
                >
                  <RotateCw size={14} /> Rotate secret
                </Menu.Item>
              )}
              <Menu.Item
                value="archive"
                color="red.500"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchive();
                }}
              >
                <Trash2 size={14} /> Archive
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </Table.Cell>
      )}
    </Table.Row>
  );
}
