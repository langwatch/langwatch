import { ListTable } from "@langwatch/design-system/list-table";
import {
  Badge,
  Button,
  Heading,
  HStack,
  NativeSelect,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { readableDate } from "@langwatch/time";
import { useState } from "react";

import { api, type RouterOutputs } from "../../../../behavior/ops-api.ts";
import { keepPreviousData } from "../../../../model/keep-previous-data.ts";

/** How many tenant rows one page asks for. */
const PAGE_SIZE = 50;

const TENANT_STATES = [
  { value: "migrated", label: "Held", color: "orange" },
  { value: "parked", label: "Parked", color: "red" },
  { value: "finalized", label: "Finalized", color: "green" },
  { value: "rolled_back", label: "Rolled back", color: "gray" },
] as const;

type TenantState = (typeof TENANT_STATES)[number]["value"];

function stateOf(value: string) {
  return TENANT_STATES.find((state) => state.value === value);
}

/** Every tenant's state per tenant step, filtered by step and state, newest movement first. */
export function UpgradeTenantList({
  steps,
}: {
  steps: readonly { name: string; title: string }[];
}) {
  const [step, setStep] = useState<string | undefined>(void 0);
  const [state, setState] = useState<TenantState | undefined>(void 0);
  const tenants = api.ops.upgrade.listTenants.useInfiniteQuery(
    { step, state, limit: PAGE_SIZE },
    {
      placeholderData: keepPreviousData,
      getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    },
  );
  const rows = tenants.data?.pages.flatMap((page) => page.items) ?? [];
  const titleOf = (name: string) => steps.find((known) => known.name === name)?.title ?? name;

  return (
    <Stack gap={3} data-testid="upgrade-tenant-list">
      <HStack gap={3} flexWrap="wrap">
        <Heading size="sm" flex={1}>
          Tenants
        </Heading>
        <NativeSelect.Root size="sm" width="240px">
          <NativeSelect.Field
            aria-label="Step"
            value={step ?? ""}
            onChange={(event) => setStep(event.target.value || void 0)}
          >
            <option value="">Every step</option>
            {steps.map((known) => (
              <option key={known.name} value={known.name}>
                {known.title}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <NativeSelect.Root size="sm" width="160px">
          <NativeSelect.Field
            aria-label="State"
            value={state ?? ""}
            onChange={(event) => setState(stateOf(event.target.value)?.value)}
          >
            <option value="">Every state</option>
            {TENANT_STATES.map((known) => (
              <option key={known.value} value={known.value}>
                {known.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </HStack>
      <TenantRows
        error={tenants.error}
        isLoading={tenants.isLoading}
        rows={rows}
        titleOf={titleOf}
      />
      {tenants.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          alignSelf="flex-start"
          loading={tenants.isFetchingNextPage}
          onClick={() => void tenants.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </Stack>
  );
}

type TenantRow = RouterOutputs["ops"]["upgrade"]["listTenants"]["items"][number];

function TenantRows({
  error,
  isLoading,
  rows,
  titleOf,
}: {
  error: unknown;
  isLoading: boolean;
  rows: readonly TenantRow[];
  titleOf: (name: string) => string;
}) {
  if (error) return <HandledErrorAlert error={error} fallbackTitle="Couldn't load the tenants" />;
  if (isLoading) return <Skeleton height="120px" aria-label="Loading tenants" />;
  if (rows.length === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No tenant has a recorded state here yet.
      </Text>
    );
  }
  return (
    <ListTable>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Tenant</Table.ColumnHeader>
          <Table.ColumnHeader>Step</Table.ColumnHeader>
          <Table.ColumnHeader>State</Table.ColumnHeader>
          <Table.ColumnHeader>Last moved</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => {
          const known = stateOf(row.status);
          return (
            <Table.Row
              key={`${row.migrationName}:${row.tenantId}`}
              data-testid={`upgrade-tenant-${row.tenantId}`}
            >
              <Table.Cell fontFamily="mono">{row.tenantId}</Table.Cell>
              <Table.Cell>{titleOf(row.migrationName)}</Table.Cell>
              <Table.Cell>
                <Badge colorPalette={known?.color ?? "gray"}>{known?.label ?? row.status}</Badge>
              </Table.Cell>
              <Table.Cell>{readableDate(row.updatedAt).toLocaleString()}</Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </ListTable>
  );
}
