import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Badge, Button, Text, VStack } from "@langwatch/design-system/primitives";
import { MoreVertical } from "lucide-react";

import { SERVICE_LABELS, type License, type Service } from "../../model/license-terms.ts";
import { AdminDate, EmptyCell, formatDate } from "../elements/admin-cells.tsx";
import { LicenseStatusBadge } from "../elements/license-status-badge.tsx";

const COLUMN_COUNT = 9;

const LICENSING_DOCS = {
  kind: "docs",
  label: "How self-hosted licenses work",
  href: "https://docs.langwatch.ai/self-hosting/licensing",
} as const;

/** What an empty list says: an empty registry, or nothing that matches what was asked. */
export type LicensesEmpty = {
  state: "empty" | "no-results";
  title: string;
  description: string;
  onClearFilters?: () => void;
};

const EMPTY_REGISTRY: LicensesEmpty = {
  state: "empty",
  title: "No licenses in the registry yet",
  description: "A license appears here once it is issued or registered.",
};

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
  empty = EMPTY_REGISTRY,
}: {
  licenses: License[];
  isLoading: boolean;
  /** What an empty list says; the default suits a registry with no licenses at all. */
  empty?: LicensesEmpty;
  onOpen: (id: string) => void;
  onRevoke: (license: License) => void;
  onResetBinding: (license: License) => void;
}) {
  return (
    <ListTable density="compact" scroll="x" scrollLabel="Licenses table">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Customer</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Plan</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Seats</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Term ends</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Hosted services</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Instance</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Last sync</ListTable.ColumnHeader>
          <ListTable.ColumnHeader width="fit" label="Actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {licenses.length === 0 && !isLoading ? (
          <ListTable.EmptyRow
            columns={COLUMN_COUNT}
            size="block"
            next={[LICENSING_DOCS]}
            {...empty}
          />
        ) : null}
        {licenses.map((license) => (
          <LicensesTableRow
            key={license.id}
            license={license}
            onOpen={() => onOpen(license.id)}
            onRevoke={() => onRevoke(license)}
            onResetBinding={() => onResetBinding(license)}
          />
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

function LicensesTableRow({
  license,
  onOpen,
  onRevoke,
  onResetBinding,
}: RowCallbacks & { license: License }) {
  return (
    <ListTable.Row onActivate={onOpen}>
      <ListTable.Cell>
        <VStack align="start" gap={0}>
          <ListTable.RowAction onActivate={onOpen}>{license.organizationName}</ListTable.RowAction>
          <Text fontSize="xs" color="fg.muted">
            {license.organizationId ? license.email : "Not linked to a customer organization"}
          </Text>
        </VStack>
      </ListTable.Cell>
      <ListTable.Cell>{license.planType}</ListTable.Cell>
      <ListTable.Cell>{license.maxMembers}</ListTable.Cell>
      <ListTable.Cell>
        <AdminDate value={license.expiresAt} display="date" />
      </ListTable.Cell>
      <ListTable.Cell>
        <LicenseStatusBadge status={license.status} />
      </ListTable.Cell>
      <ListTable.Cell>
        <ServicesCell services={license.services} />
      </ListTable.Cell>
      <ListTable.Cell>
        {license.instanceId ? (
          <Badge colorPalette="green">bound</Badge>
        ) : (
          <EmptyCell>not bound</EmptyCell>
        )}
      </ListTable.Cell>
      <ListTable.Cell>
        <SyncCell license={license} />
      </ListTable.Cell>
      <ListTable.Cell>
        <RowActions
          license={license}
          onOpen={onOpen}
          onRevoke={onRevoke}
          onResetBinding={onResetBinding}
        />
      </ListTable.Cell>
    </ListTable.Row>
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
          size="sm"
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
