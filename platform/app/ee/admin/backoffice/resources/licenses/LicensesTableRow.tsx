import { Badge, Button, Table, Text, VStack } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import { Menu } from "~/components/ui/menu";
import { EmptyCell, formatDate } from "../../BackofficeTable";
import { StatusBadge } from "./StatusBadge";
import { type License, SERVICE_LABELS, type Service } from "./types";

interface RowCallbacks {
  onOpen: () => void;
  onRevoke: () => void;
  onResetBinding: () => void;
}

export function LicensesTableRow({
  license,
  onOpen,
  onRevoke,
  onResetBinding,
}: RowCallbacks & { license: License }) {
  return (
    <Table.Row cursor="pointer" onClick={onOpen}>
      <Table.Cell>
        <CustomerCell license={license} />
      </Table.Cell>
      <Table.Cell>{license.planType}</Table.Cell>
      <Table.Cell>
        {license.maxMembers}
        <Text as="span" fontSize="xs" color="fg.muted">
          {" "}
          +{license.effectiveSeatOverageAllowance} allowance
        </Text>
      </Table.Cell>
      <Table.Cell>{formatDate(license.expiresAt)}</Table.Cell>
      <Table.Cell>
        <StatusBadge status={license.status} />
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

function CustomerCell({ license }: { license: License }) {
  return (
    <VStack align="start" gap={0}>
      <Text fontWeight="medium">{license.organizationName}</Text>
      <Text fontSize="xs" color="fg.muted">
        {license.organizationId
          ? license.email
          : "Not linked to a customer organization"}
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
          service in SERVICE_LABELS
            ? SERVICE_LABELS[service as Service]
            : service,
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
