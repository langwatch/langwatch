import { Badge, Button, Table, Text, VStack } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { MoreVertical } from "lucide-react";

import { SERVICE_LABELS, type License, type Service } from "../../model/license-terms.ts";
import { EmptyCell, formatDate } from "../elements/backoffice-cells.tsx";
import { LicenseStatusBadge } from "../elements/license-status-badge.tsx";

const COLUMN_COUNT = 9;

interface RowCallbacks {
  onOpen: () => void;
  onRevoke: () => void;
  onResetBinding: () => void;
}

export function LicensesTable({
  licenses,
  isLoading,
  onOpen,
  onRevoke,
  onResetBinding,
}: {
  licenses: License[];
  isLoading: boolean;
  onOpen: (id: string) => void;
  onRevoke: (license: License) => void;
  onResetBinding: (license: License) => void;
}) {
  return (
    <Table.Root variant="line" size="md">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Customer</Table.ColumnHeader>
          <Table.ColumnHeader>Plan</Table.ColumnHeader>
          <Table.ColumnHeader>Seats</Table.ColumnHeader>
          <Table.ColumnHeader>Term ends</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          <Table.ColumnHeader>Hosted services</Table.ColumnHeader>
          <Table.ColumnHeader>Instance</Table.ColumnHeader>
          <Table.ColumnHeader>Last sync</Table.ColumnHeader>
          <Table.ColumnHeader width="1%" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {licenses.length === 0 && !isLoading ? <EmptyRow /> : null}
        {licenses.map((license) => (
          <LicensesTableRow
            key={license.id}
            license={license}
            onOpen={() => onOpen(license.id)}
            onRevoke={() => onRevoke(license)}
            onResetBinding={() => onResetBinding(license)}
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
          No licenses in the registry yet.
        </Text>
      </Table.Cell>
    </Table.Row>
  );
}

function LicensesTableRow({
  license,
  onOpen,
  onRevoke,
  onResetBinding,
}: RowCallbacks & { license: License }) {
  return (
    <Table.Row cursor="pointer" onClick={onOpen}>
      <Table.Cell>
        <VStack align="start" gap={0}>
          <Text fontWeight="medium">{license.organizationName}</Text>
          <Text fontSize="xs" color="fg.muted">
            {license.organizationId ? license.email : "Not linked to a customer organization"}
          </Text>
        </VStack>
      </Table.Cell>
      <Table.Cell>{license.planType}</Table.Cell>
      <Table.Cell>{license.maxMembers}</Table.Cell>
      <Table.Cell>{formatDate(license.expiresAt)}</Table.Cell>
      <Table.Cell>
        <LicenseStatusBadge status={license.status} />
      </Table.Cell>
      <Table.Cell>
        <ServicesCell services={license.services} />
      </Table.Cell>
      <Table.Cell>
        {license.instanceId ? (
          <Badge colorPalette="green">bound</Badge>
        ) : (
          <EmptyCell>not bound</EmptyCell>
        )}
      </Table.Cell>
      <Table.Cell>
        <SyncCell license={license} />
      </Table.Cell>
      <Table.Cell>
        <RowActions
          license={license}
          onOpen={onOpen}
          onRevoke={onRevoke}
          onResetBinding={onResetBinding}
        />
      </Table.Cell>
    </Table.Row>
  );
}

function SyncCell({ license }: { license: License }) {
  if (!license.lastSyncAt) return <EmptyCell>never synced</EmptyCell>;
  return (
    <VStack align="start" gap={0}>
      <Text>
        {formatDate(license.lastSyncAt)}
        {license.lastSyncVersion ? ` (${license.lastSyncVersion})` : ""}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {license.reportedMembers ?? 0} in use
      </Text>
    </VStack>
  );
}

function ServicesCell({ services }: { services: License["services"] }) {
  if (services.length === 0) return <EmptyCell>none</EmptyCell>;
  return (
    <>
      {services
        .map((service) =>
          service in SERVICE_LABELS ? SERVICE_LABELS[service as Service] : service,
        )
        .join(", ")}
    </>
  );
}

function RowActions({
  license,
  onOpen,
  onRevoke,
  onResetBinding,
}: RowCallbacks & { license: License }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${license.organizationName}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="open"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          Open
        </Menu.Item>
        {license.instanceId ? (
          <Menu.Item
            value="reset-binding"
            onClick={(event) => {
              event.stopPropagation();
              onResetBinding();
            }}
          >
            Reset instance binding
          </Menu.Item>
        ) : null}
        {license.status === "active" || license.status === "expired" ? (
          <Menu.Item
            value="revoke"
            color="fg.error"
            onClick={(event) => {
              event.stopPropagation();
              onRevoke();
            }}
          >
            Revoke
          </Menu.Item>
        ) : null}
      </Menu.Content>
    </Menu.Root>
  );
}
