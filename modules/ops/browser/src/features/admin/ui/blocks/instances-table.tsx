import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Text, VStack } from "@langwatch/design-system/primitives";
import { Inbox } from "lucide-react";

import {
  ACTIVITY_COLORS,
  ACTIVITY_LABELS,
  instanceName,
  reportNumber,
  type SelfHostedInstance,
} from "../../model/self-hosted-instance.ts";
import { AdminDate, EmptyCell } from "../elements/admin-cells.tsx";
import { ShortId } from "../elements/short-id.tsx";

const COLUMN_COUNT = 8;

export function InstancesTable({
  instances,
  isLoading,
  onOpen,
}: {
  instances: SelfHostedInstance[];
  isLoading: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <ListTable density="compact" scroll="x" scrollLabel="Self-hosted instances table">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Install</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Release</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Activity</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Last report</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>First seen</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Size</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Last 28 days</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>License</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {instances.length === 0 && !isLoading ? <EmptyRow /> : null}
        {instances.map((instance) => (
          <InstancesTableRow
            key={instance.id}
            instance={instance}
            onOpen={() => onOpen(instance.id)}
          />
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

function EmptyRow() {
  return (
    <ListTable.SpanRow columns={COLUMN_COUNT}>
      <NoDataInfoBlock
        icon={<Inbox />}
        title="No self-hosted install has reported yet."
        description="Records will appear here when they are available."
      />
    </ListTable.SpanRow>
  );
}

function InstancesTableRow({
  instance,
  onOpen,
}: {
  instance: SelfHostedInstance;
  onOpen: () => void;
}) {
  return (
    <ListTable.Row onActivate={onOpen}>
      <ListTable.Cell>
        <WhoCell instance={instance} onOpen={onOpen} />
      </ListTable.Cell>
      <ListTable.Cell>
        <ReleaseCell instance={instance} />
      </ListTable.Cell>
      <ListTable.Cell>
        <Badge colorPalette={ACTIVITY_COLORS[instance.activity]}>
          {ACTIVITY_LABELS[instance.activity]}
        </Badge>
      </ListTable.Cell>
      <ListTable.Cell>
        <AdminDate value={instance.lastSeenAt} display="date" />
      </ListTable.Cell>
      <ListTable.Cell>
        <AdminDate value={instance.firstSeenAt} display="date" />
      </ListTable.Cell>
      <ListTable.Cell>
        <SizeCell instance={instance} />
      </ListTable.Cell>
      <ListTable.Cell>
        <UsageCell instance={instance} />
      </ListTable.Cell>
      <ListTable.Cell>
        {instance.organizationId ? (
          <Badge colorPalette="purple">licensed</Badge>
        ) : (
          <EmptyCell>open source</EmptyCell>
        )}
      </ListTable.Cell>
    </ListTable.Row>
  );
}

/**
 * Who runs this install: the customer when a license named one, the largest
 * email domain when it did not, and the instance id when neither is known.
 */
function WhoCell({ instance, onOpen }: { instance: SelfHostedInstance; onOpen: () => void }) {
  return (
    <VStack align="start" gap={0}>
      <ListTable.RowAction onActivate={onOpen}>{instanceName(instance)}</ListTable.RowAction>
      {instance.hostname ? (
        <Text fontSize="xs" color="fg.muted">
          {instance.hostname}
        </Text>
      ) : (
        <ShortId id={instance.instanceId} />
      )}
    </VStack>
  );
}

function ReleaseCell({ instance }: { instance: SelfHostedInstance }) {
  if (!instance.version) return <EmptyCell />;
  return (
    <VStack align="start" gap={0}>
      <Text>{instance.version}</Text>
      <Text fontSize="xs" color="fg.muted">
        {instance.installMethod ?? "unknown install"}
        {instance.chartVersion ? ` ${instance.chartVersion}` : ""}
      </Text>
    </VStack>
  );
}

function SizeCell({ instance }: { instance: SelfHostedInstance }) {
  const users = reportNumber(instance.latestReport, "users");
  const projects = reportNumber(instance.latestReport, "projects");
  if (users === null && projects === null) return <EmptyCell />;
  return (
    <VStack align="start" gap={0}>
      <Text>{users ?? 0} users</Text>
      <Text fontSize="xs" color="fg.muted">
        {projects ?? 0} projects
      </Text>
    </VStack>
  );
}

/**
 * What they do, over the last 28 days rather than lifetime: an install that
 * ingested heavily two years ago and nothing since reads exactly like a live
 * one on a lifetime total.
 */
function UsageCell({ instance }: { instance: SelfHostedInstance }) {
  if (!instance.optionalMetricsReported) {
    return <EmptyCell>opted out</EmptyCell>;
  }
  const traces = reportNumber(instance.latestReport, "traces_28d");
  const activeUsers = reportNumber(instance.latestReport, "active_users_28d");
  if (traces === null && activeUsers === null) return <EmptyCell />;
  return (
    <VStack align="start" gap={0}>
      <Text>
        <FormattedNumber value={traces ?? 0} /> traces
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {activeUsers ?? 0} active users
      </Text>
    </VStack>
  );
}
