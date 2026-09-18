import { Box, Collapsible, HStack, IconButton, Table, Text } from "@chakra-ui/react";
import type { ParkedTenant } from "@langwatch/ops-contract";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { formatCount, formatTimeAgo } from "../../../../model/ops-formatters.ts";
import { middleEllipsis } from "../../../../model/queue-cluster-groups.ts";

export type ParkedGroupsRender = (
  tenant: Pick<ParkedTenant, "tenantId" | "queueName">,
) => ReactNode;

/** Labels which tenants are parked (the alarming number needs context—flow control
 * working correctly). One of three sections under paused panel; no own card. */
export function ParkedTenantsSection({
  parkedTenants,
  parkedTenantsBound,
  renderParkedGroups,
}: {
  parkedTenants: ParkedTenant[];
  parkedTenantsBound: { total: number; included: number };
  renderParkedGroups?: ParkedGroupsRender;
}) {
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
          These tenants are at their in-flight capacity limit. Their work is waiting its turn so
          other tenants keep moving. Nothing has failed.
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
                renderParkedGroups={renderParkedGroups}
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
  renderParkedGroups,
}: {
  tenantId: string;
  queueName: string;
  groupCount: number;
  oldestParkedMs: number | null;
  renderParkedGroups?: ParkedGroupsRender;
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
              open ? `Hide parked groups for ${tenantId}` : `Show parked groups for ${tenantId}`
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
                {renderParkedGroups?.({ tenantId, queueName })}
              </Collapsible.Content>
            </Collapsible.Root>
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}
