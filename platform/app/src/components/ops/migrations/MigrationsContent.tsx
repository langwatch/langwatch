import {
  Badge,
  Box,
  Button,
  Center,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Play } from "lucide-react";
import { useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api, type RouterOutputs } from "~/utils/api";
import { JsonViewer } from "../JsonViewer";

const STATUS_COLOR: Record<string, string> = {
  finalized: "green",
  migrated: "orange",
  parked: "red",
};

const STATUS_LABEL: Record<string, string> = {
  finalized: "Finalized",
  migrated: "Held",
  parked: "Parked",
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

  if (query.error) {
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
        <MigrationSection key={migration.name} migration={migration} />
      ))}
    </Stack>
  );
}

type MigrationListing = RouterOutputs["ops"]["listSystemMigrations"][number];

function MigrationSection({ migration }: { migration: MigrationListing }) {
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
