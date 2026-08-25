import {
  Box,
  Collapsible,
  HStack,
  IconButton,
  Spinner,
  Table,
  Text,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { middleEllipsis } from "~/components/ops/queues/clusterGroups";
import { formatCount, formatTimeAgo } from "@langwatch/ops-web";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";

/**
 * Which tenants are parked, and how badly.
 *
 * The Parked tile could read 129,091 with nothing anywhere on the page naming a
 * tenant — an alarm with the label torn off. This section is the label. It also
 * says what parked MEANS, because an orange six-figure number that describes
 * flow control working correctly otherwise reads as an outage.
 *
 * One of three sections under the paused panel. It owns no card of its own:
 * "what is switched off" is one question, and PausedCard is where it is
 * answered — including the decision to render nothing when nothing is.
 */
export function ParkedTenantsSection({
  parkedTenants,
  parkedTenantsBound,
}: Pick<DashboardData, "parkedTenants" | "parkedTenantsBound">) {
  if (parkedTenants.length === 0) return null;

  return (
    <Box>
      <Box paddingX={4} paddingTop={3} paddingBottom={2}>
        <HStack gap={2}>
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">
            Parked tenants
          </Text>
          {parkedTenantsBound.total > parkedTenantsBound.included && (
            <Text textStyle="xs" color="fg.muted">
              showing {parkedTenantsBound.included} of {parkedTenantsBound.total}
            </Text>
          )}
        </HStack>
        <Text textStyle="xs" color="fg.muted" marginTop={1}>
          These tenants are at their in-flight capacity limit. Their work is waiting its
          turn so other tenants keep moving — nothing has failed.
        </Text>
      </Box>
      <Table.ScrollArea>
        <Table.Root
          size="sm"
          variant="line"
          css={{ "& tr:last-child td": { borderBottom: "none" } }}
        >
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader width="40px" />
              <Table.ColumnHeader>Tenant</Table.ColumnHeader>
              <Table.ColumnHeader>Queue</Table.ColumnHeader>
              <Table.ColumnHeader>Parked groups</Table.ColumnHeader>
              <Table.ColumnHeader>Oldest wait</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {parkedTenants.map((tenant) => (
              <ParkedTenantRow
                key={`${tenant.queueName}::${tenant.tenantId}`}
                tenantId={tenant.tenantId}
                queueName={tenant.queueName}
                groupCount={tenant.groupCount}
                oldestParkedMs={tenant.oldestParkedMs}
              />
            ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
    </Box>
  );
}

function ParkedTenantRow({
  tenantId,
  queueName,
  groupCount,
  oldestParkedMs,
}: {
  tenantId: string;
  queueName: string;
  groupCount: number;
  oldestParkedMs: number | null;
}) {
  const [open, setOpen] = useState(false);
  // The disclosed content is a SIBLING row, not a descendant of the button, so
  // there is no implicit relationship for a screen reader to follow — without
  // this pairing it hears "expanded" and has no way to reach what expanded.
  const panelId = `parked-groups-${queueName}-${tenantId}`;

  return (
    <>
      <Table.Row data-testid="parked-tenant-row">
        <Table.Cell>
          {/* The control is a real button, not a clickable row: a row cannot be
              focused or activated from the keyboard, which puts the only route
              to the drill-down behind a mouse. */}
          <IconButton
            aria-label={
              open
                ? `Hide parked groups for ${tenantId}`
                : `Show parked groups for ${tenantId}`
            }
            aria-expanded={open}
            aria-controls={panelId}
            variant="ghost"
            size="2xs"
            color="fg.muted"
            onClick={() => setOpen((prior) => !prior)}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </IconButton>
        </Table.Cell>
        <Table.Cell>
          <Text fontFamily="mono" textStyle="xs" title={tenantId}>
            {middleEllipsis(tenantId, 32)}
          </Text>
        </Table.Cell>
        <Table.Cell color="fg.muted">{queueName}</Table.Cell>
        <Table.Cell>
          <Text fontWeight="medium">{formatCount(groupCount)}</Text>
        </Table.Cell>
        <Table.Cell color="fg.muted">{formatTimeAgo(oldestParkedMs)}</Table.Cell>
      </Table.Row>
      {open && (
        <Table.Row>
          <Table.Cell colSpan={5} padding={0}>
            <Collapsible.Root open>
              <Collapsible.Content id={panelId}>
                <ParkedGroupList queueName={queueName} tenantId={tenantId} />
              </Collapsible.Content>
            </Collapsible.Root>
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}

/**
 * A tenant's parked groups, read live rather than from the snapshot.
 *
 * A parking storm holds far too many groups to ship in a snapshot every pod
 * reads, so the members are fetched only for the tenant an operator opened.
 */
function ParkedGroupList({
  queueName,
  tenantId,
}: {
  queueName: string;
  tenantId: string;
}) {
  const query = api.ops.listParkedGroups.useQuery(
    { queueName, tenantId, page: 1, pageSize: 20 },
    { refetchInterval: 10_000 },
  );

  if (query.isLoading) {
    return (
      <HStack paddingX={6} paddingY={3} gap={2}>
        <Spinner size="xs" />
        <Text textStyle="xs" color="fg.muted">
          Loading parked groups
        </Text>
      </HStack>
    );
  }

  // A failed read is not an empty result. Rendering "nothing is parked any
  // more" over an error tells the operator the problem resolved itself during
  // the incident that broke the query.
  if (query.isError) {
    return (
      <Text textStyle="xs" color="red.500" paddingX={6} paddingY={3}>
        Could not load this tenant's parked groups. The count above still stands — do not
        read this as cleared.
      </Text>
    );
  }

  const groups = query.data?.groups ?? [];
  if (groups.length === 0) {
    return (
      <Text textStyle="xs" color="fg.muted" paddingX={6} paddingY={3}>
        This tenant dropped below its limit — nothing is parked any more.
      </Text>
    );
  }

  return (
    <Box paddingX={6} paddingY={2} background="bg.subtle">
      {query.data && query.data.total > groups.length && (
        <Text textStyle="xs" color="fg.muted" paddingBottom={1}>
          Showing {groups.length} of {formatCount(query.data.total)} parked groups
        </Text>
      )}
      {groups.map((group) => (
        <HStack key={group.groupId} gap={3} paddingY={1}>
          <Text fontFamily="mono" textStyle="xs" title={group.groupId} flex="1" truncate>
            {middleEllipsis(group.groupId, 64)}
          </Text>
          <Text textStyle="xs" color="fg.muted">
            {group.pipelineName ?? "—"}
          </Text>
          <Text textStyle="xs" color="fg.muted" minWidth="70px">
            {group.pendingJobs} pending
          </Text>
          <Text textStyle="xs" color="fg.muted" minWidth="70px">
            {formatTimeAgo(group.oldestJobMs)}
          </Text>
        </HStack>
      ))}
    </Box>
  );
}
