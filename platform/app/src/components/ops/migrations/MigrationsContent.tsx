import {
  Badge,
  Box,
  Button,
  Center,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Play, Undo2 } from "lucide-react";
import { useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api, type RouterOutputs } from "~/utils/api";
import { JsonViewer } from "../JsonViewer";
import { ConfirmDialog } from "../shared/ConfirmDialog";

const STATUS_COLOR: Record<string, string> = {
  finalized: "green",
  migrated: "orange",
  parked: "red",
  rolled_back: "gray",
};

const STATUS_LABEL: Record<string, string> = {
  finalized: "Finalized",
  migrated: "Held",
  parked: "Parked",
  rolled_back: "Rolled back",
};

export function MigrationsContent() {
  const { scope } = useOpsPermission();
  const canManage = scope?.kind === "platform";

  const query = api.ops.listSystemMigrations.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const utils = api.useUtils();
  const runPass = api.ops.runSystemMigrationPass.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Migration pass started",
        description:
          "The pass runs in the background under the fleet-wide lease. This page refreshes as organizations move.",
        type: "success",
      });
      await utils.ops.listSystemMigrations.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't start the pass" }),
  });

  if (query.isLoading) {
    return (
      <Center paddingY={20}>
        <Spinner />
      </Center>
    );
  }

  // Only when there is nothing to show. This view polls every 30s, and a
  // failed refetch keeps the last good data - replacing a loaded table with
  // an error panel because one poll blipped loses the operator's place.
  if (query.error && !query.data) {
    return (
      <Center paddingY={20}>
        <HandledErrorAlert
          error={query.error}
          fallbackTitle="Couldn't load system migrations"
        />
      </Center>
    );
  }

  return (
    <Stack gap={8} paddingY={4} maxWidth="1200px">
      <HStack alignItems="flex-start">
        <Text fontSize="sm" color="fg.muted" maxWidth="720px">
          One-time data migrations the system performs on itself, organization
          by organization, at worker boot. Held organizations finished the work
          but failed the parity proof - they stay on their legacy path, behaving
          exactly as before, until the disagreement in their report is resolved
          and a later pass re-verifies them. Parked organizations hit an error
          and are retried automatically.
        </Text>
        <Spacer />
        <Button
          size="sm"
          disabled={!canManage}
          loading={runPass.isPending}
          onClick={() => runPass.mutate()}
        >
          <Play size={14} /> Run a pass now
        </Button>
      </HStack>

      {(query.data ?? []).map((migration) => (
        <MigrationSection
          key={migration.name}
          migration={migration}
          canManage={canManage}
        />
      ))}
    </Stack>
  );
}

type MigrationListing = RouterOutputs["ops"]["listSystemMigrations"][number];

function MigrationSection({
  migration,
  canManage,
}: {
  migration: MigrationListing;
  canManage: boolean;
}) {
  return (
    <Box>
      <HStack marginBottom={3}>
        <Heading size="md" fontFamily="mono">
          {migration.name}
        </Heading>
        <Badge colorPalette="green">
          Finalized {migration.counts.finalized}
        </Badge>
        <Badge colorPalette="orange">Held {migration.counts.migrated}</Badge>
        <Badge colorPalette="red">Parked {migration.counts.parked}</Badge>
        {migration.counts.rolled_back > 0 && (
          <Badge colorPalette="gray">
            Rolled back {migration.counts.rolled_back}
          </Badge>
        )}
        <Spacer />
        {canManage && <RollBackAction migrationName={migration.name} />}
      </HStack>
      {migration.attention.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No organizations need attention.
        </Text>
      ) : (
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Organization</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader>Last movement</Table.ColumnHeader>
              <Table.ColumnHeader>Report</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {migration.attention.map((record) => (
              <AttentionRow
                key={`${record.migrationName}:${record.tenantId}`}
                record={record}
              />
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Box>
  );
}

/**
 * The state machine's one human-driven edge: finalized → rolled_back.
 * Finalized organizations are a count rather than a listing, so the
 * operator names the organization instead of picking a row — they arrive
 * here knowing exactly which organization needs to go back.
 */
function RollBackAction({ migrationName }: { migrationName: string }) {
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const utils = api.useUtils();
  const rollBack = api.ops.rollBackSystemMigrationTenant.useMutation({
    onSuccess: async () => {
      toaster.create({
        title: "Organization rolled back",
        description:
          "It is pinned to its legacy path again. Permission checks pick the change up within a minute, and later passes leave it alone.",
        type: "success",
      });
      setOpen(false);
      setTenantId("");
      await utils.ops.listSystemMigrations.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't roll back" }),
  });

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <Undo2 size={13} /> Roll back…
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false);
          // Drop the typed id with the dialog. Reopening for a DIFFERENT
          // organization must not arrive pre-filled with the last one and
          // the confirm button already live.
          setTenantId("");
        }}
        onConfirm={() =>
          rollBack.mutate({
            migrationName,
            tenantId: tenantId.trim(),
            confirm: "ROLL BACK",
          })
        }
        title="Roll an organization back to its legacy path"
        description="The organization returns to the behavior it had before this migration finalized, and stays there until an operator intervenes again. Only finalized organizations can be rolled back. Enter the organization id."
        isLoading={rollBack.isPending}
        confirmDisabled={tenantId.trim().length === 0}
      >
        <Input
          marginTop={3}
          size="sm"
          fontFamily="mono"
          placeholder="organization id"
          value={tenantId}
          onChange={(event) => setTenantId(event.target.value)}
        />
      </ConfirmDialog>
    </>
  );
}

function AttentionRow({
  record,
}: {
  record: MigrationListing["attention"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Table.Row>
        <Table.Cell fontFamily="mono">{record.tenantId}</Table.Cell>
        <Table.Cell>
          <Badge colorPalette={STATUS_COLOR[record.status] ?? "gray"}>
            {STATUS_LABEL[record.status] ?? record.status}
          </Badge>
        </Table.Cell>
        <Table.Cell>{new Date(record.updatedAt).toLocaleString()}</Table.Cell>
        <Table.Cell>
          {record.report == null ? (
            <Text fontSize="sm" color="fg.muted">
              No report
            </Text>
          ) : (
            <Button
              size="xs"
              variant="outline"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Hide report" : "Show report"}
            </Button>
          )}
        </Table.Cell>
      </Table.Row>
      {expanded && record.report != null && (
        <Table.Row>
          <Table.Cell colSpan={4}>
            <JsonViewer data={record.report} maxHeight="320px" />
          </Table.Cell>
        </Table.Row>
      )}
    </>
  );
}
