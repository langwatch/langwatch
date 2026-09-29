import { Badge, Table, Text, VStack } from "@chakra-ui/react";

import {
  ACTIVITY_COLORS,
  ACTIVITY_LABELS,
  reportNumber,
  sortedDomains,
  type SelfHostedInstance,
} from "../../model/self-hosted-instance.ts";
import { EmptyCell, formatDate } from "../elements/backoffice-cells.tsx";
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
    <Table.Root variant="line" size="md">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Install</Table.ColumnHeader>
          <Table.ColumnHeader>Release</Table.ColumnHeader>
          <Table.ColumnHeader>Activity</Table.ColumnHeader>
          <Table.ColumnHeader>Last report</Table.ColumnHeader>
          <Table.ColumnHeader>First seen</Table.ColumnHeader>
          <Table.ColumnHeader>Size</Table.ColumnHeader>
          <Table.ColumnHeader>Last 28 days</Table.ColumnHeader>
          <Table.ColumnHeader>License</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {instances.length === 0 && !isLoading ? <EmptyRow /> : null}
        {instances.map((instance) => (
          <InstancesTableRow
            key={instance.id}
            instance={instance}
            onOpen={() => onOpen(instance.id)}
          />
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function EmptyRow() {
  return (
    <Table.Row>
      <Table.Cell colSpan={COLUMN_COUNT}>
        <Text color="fg.muted" fontSize="sm">
          No self-hosted install has reported yet.
        </Text>
      </Table.Cell>
    </Table.Row>
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
    <Table.Row cursor="pointer" onClick={onOpen}>
      <Table.Cell>
        <WhoCell instance={instance} />
      </Table.Cell>
      <Table.Cell>
        <ReleaseCell instance={instance} />
      </Table.Cell>
      <Table.Cell>
        <Badge colorPalette={ACTIVITY_COLORS[instance.activity]}>
          {ACTIVITY_LABELS[instance.activity]}
        </Badge>
      </Table.Cell>
      <Table.Cell>{formatDate(instance.lastSeenAt)}</Table.Cell>
      <Table.Cell>{formatDate(instance.firstSeenAt)}</Table.Cell>
      <Table.Cell>
        <SizeCell instance={instance} />
      </Table.Cell>
      <Table.Cell>
        <UsageCell instance={instance} />
      </Table.Cell>
      <Table.Cell>
        {instance.organizationId ? (
          <Badge colorPalette="purple">licensed</Badge>
        ) : (
          <EmptyCell>open source</EmptyCell>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

/**
 * Who runs this install: the customer when a license named one, the largest
 * email domain when it did not, and the instance id when neither is known.
 */
function WhoCell({ instance }: { instance: SelfHostedInstance }) {
  const domains = sortedDomains(instance.userEmailDomains);
  const leading = domains[0];

  return (
    <VStack align="start" gap={0}>
      <Text fontWeight="medium">{instance.organizationName ?? leading?.domain ?? "Unknown"}</Text>
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
      <Text>{(traces ?? 0).toLocaleString()} traces</Text>
      <Text fontSize="xs" color="fg.muted">
        {activeUsers ?? 0} active users
      </Text>
    </VStack>
  );
}
