import { IdText } from "@langwatch/design-system/id-text";
import { ListTable } from "@langwatch/design-system/list-table";
import { Box, Collapsible, HStack, Text } from "@langwatch/design-system/primitives";
import type { ParkedTenant } from "@langwatch/ops-contract";
import type { ReactNode } from "react";
import { useState } from "react";

import { formatCount, formatTimeAgo } from "../../../../model/ops-formatters.ts";

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
      <ListTable density="compact" variant="embedded" scroll="x" scrollLabel="Parked tenants">
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader width={40} label="Expand" />
            <ListTable.ColumnHeader>Tenant</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Queue</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Parked groups</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Oldest wait</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
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
        </ListTable.Body>
      </ListTable>
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
      <ListTable.Row expanded={open} data-testid="parked-tenant-row">
        <ListTable.ExpandCell
          expanded={open}
          onToggle={() => setOpen((prior) => !prior)}
          label={open ? `Hide parked groups for ${tenantId}` : `Show parked groups for ${tenantId}`}
          panelId={panelId}
        />
        <ListTable.Cell>
          <IdText value={tenantId} label="ID" />
        </ListTable.Cell>
        <ListTable.Cell tone="muted">{queueName}</ListTable.Cell>
        <ListTable.Cell>
          <Text fontWeight="medium">{formatCount(groupCount)}</Text>
        </ListTable.Cell>
        <ListTable.Cell tone="muted">{formatTimeAgo(oldestParkedMs)}</ListTable.Cell>
      </ListTable.Row>
      {open && (
        <ListTable.SpanRow columns={5} id={panelId}>
          <Collapsible.Root open>
            <Collapsible.Content>
              {renderParkedGroups?.({ tenantId, queueName })}
            </Collapsible.Content>
          </Collapsible.Root>
        </ListTable.SpanRow>
      )}
    </>
  );
}
