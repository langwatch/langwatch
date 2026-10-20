import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListPageSkeleton } from "@langwatch/design-system/list-page";
import { ListTable } from "@langwatch/design-system/list-table";
import {
  Badge,
  Button,
  Heading,
  HStack,
  NativeSelect,
  Stack,
  Table,
  Text,
} from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
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

/** A `migrated` row of a step whose steady state that is: kept in step, not held. */
const KEPT_IN_STEP = { value: "migrated", label: "Kept in step", color: "gray" } as const;

type TenantState = (typeof TENANT_STATES)[number]["value"];

function stateOf(value: string) {
  return TENANT_STATES.find((state) => state.value === value);
}

/** Every organization's state per step, filtered by step and state, newest movement first. */
export function UpgradeTenantList({
  steps,
}: {
  steps: readonly { name: string; title: string; migratedIsSteady: boolean }[];
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
  const stateOfRow = (row: { migrationName: string; status: string }) =>
    row.status === "migrated" &&
    steps.some((known) => known.name === row.migrationName && known.migratedIsSteady)
      ? KEPT_IN_STEP
      : stateOf(row.status);

  return (
    <Stack gap={3} data-testid="upgrade-tenant-list">
      <HStack gap={3} flexWrap="wrap">
        <Heading size="sm" flex={1}>
          Organizations
        </Heading>
        <NativeSelect.Root size="sm" width={{ base: "full", md: "60" }}>
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
        <NativeSelect.Root size="sm" width={{ base: "full", md: "40" }}>
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
        stateOfRow={stateOfRow}
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
  stateOfRow,
}: {
  error: unknown;
  isLoading: boolean;
  rows: readonly TenantRow[];
  titleOf: (name: string) => string;
  /** A steady step's `migrated` row reads kept in step, not held. */
  stateOfRow: (row: TenantRow) => { label: string; color: string } | undefined;
}) {
  if (error)
    return <HandledErrorAlert error={error} fallbackTitle="Couldn't load the organizations" />;
  if (isLoading) return <ListPageSkeleton label="Loading organizations" />;
  if (rows.length === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        No organization has a recorded state here yet.
      </Text>
    );
  }
  return (
    <ListTable density="compact" columnRules={false} containerProps={{ overflowX: "auto" }}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Organization</Table.ColumnHeader>
          <Table.ColumnHeader>Step</Table.ColumnHeader>
          <Table.ColumnHeader>State</Table.ColumnHeader>
          <Table.ColumnHeader>Last moved</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => {
          const known = stateOfRow(row);
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
              <Table.Cell>
                <FormattedDate value={row.updatedAt} />
              </Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </ListTable>
  );
}
