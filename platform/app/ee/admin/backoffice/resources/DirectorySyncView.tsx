import {
  Badge,
  Box,
  Button,
  HStack,
  SimpleGrid,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { Drawer } from "~/components/ui/drawer";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import type { OversightSyncList } from "~/server/app-layer/identity/scim-oversight.service";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { BackofficeTable, EmptyCell, formatDateTime } from "../BackofficeTable";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 6;

/**
 * Directory sync across every customer, in the back office (ADR-122).
 *
 * The `SsoConnectionsView` shell, deliberately: same `BackofficeTable`, same
 * debounced search and paging, same per-row overflow menu, same drawer beside
 * the list. This is one more page of an existing kind, not a new kind of
 * surface, and an operator who knows the connections list already knows this.
 *
 * What it shows that the customer's own page never will: the reason code
 * behind a failure, how many times it was attempted, and the
 * `externalId <-> userId` mapping — the row that explains why a push matched
 * the wrong nobody. And it offers the one write either surface has: sending a
 * retired apply through again, once its cause is fixed.
 */
export default function DirectorySyncView() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const openConnectionId =
    typeof router.query.connection === "string"
      ? router.query.connection
      : null;

  const list = api.scimOversight.getAll.useQuery({
    page: page - 1,
    pageSize: PAGE_SIZE,
    search: debouncedSearch.trim() || undefined,
  });

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const setOpenConnection = (connectionId: string | null) => {
    const query = { ...router.query } as Record<string, unknown>;
    if (connectionId) {
      query.connection = connectionId;
    } else {
      delete query.connection;
    }
    void router.replace({ query }, undefined, { shallow: true });
  };

  return (
    <>
      <BackofficeTable
        title="Directory Sync"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by connection, organization or state"
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        pagination={{
          page,
          perPage: PAGE_SIZE,
          total: list.data?.total ?? 0,
          onPageChange: setPage,
        }}
      >
        <SyncsTable syncs={list.data?.syncs} onOpen={setOpenConnection} />
      </BackofficeTable>

      <SyncDrawer
        connectionId={openConnectionId}
        onClose={() => setOpenConnection(null)}
      />
    </>
  );
}

/** Colour tracks whether a customer's directory is doing its job. */
const STATE_TONE: Record<string, string> = {
  TOKEN_ISSUED: "gray",
  SYNCING: "green",
  ERROR: "red",
  REVOKED: "gray",
};

/**
 * Taken from the SERVICE's own return type rather than inferred back out of
 * the query hook: the permission-checked procedure builder does not thread a
 * handler's output through, so the hook's `data` widens to `{}`. A type-only
 * import is erased, so this crosses no server/client boundary.
 */
type OversightList = OversightSyncList;
type SyncRow = OversightList["syncs"][number];
type Failure = SyncRow["deadLetters"][number];

function SyncsTable({
  syncs,
  onOpen,
}: {
  syncs: SyncRow[] | undefined;
  onOpen: (connectionId: string) => void;
}) {
  return (
    <Table.Root variant="line" size="md" width="full">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Organization</Table.ColumnHeader>
          <Table.ColumnHeader>State</Table.ColumnHeader>
          <Table.ColumnHeader>Last push</Table.ColumnHeader>
          <Table.ColumnHeader>Standing failure</Table.ColumnHeader>
          <Table.ColumnHeader>Retired</Table.ColumnHeader>
          <Table.ColumnHeader width="60px" textAlign="right" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {syncs?.length === 0 && (
          <Table.Row>
            <Table.Cell colSpan={COLUMN_COUNT}>
              <Text color="fg.muted" textAlign="center" paddingY={6}>
                No directory sync matches your search.
              </Text>
            </Table.Cell>
          </Table.Row>
        )}
        {syncs?.map((sync) => (
          <Table.Row
            key={sync.connectionId}
            cursor="pointer"
            _hover={{ backgroundColor: "bg.muted" }}
            onClick={() => onOpen(sync.connectionId)}
          >
            <Table.Cell>
              <VStack align="start" gap={0}>
                <Text>{sync.organizationName ?? <EmptyCell />}</Text>
                <Text fontSize="xs" color="fg.muted">
                  {sync.connectionId}
                </Text>
              </VStack>
            </Table.Cell>
            <Table.Cell>
              <Badge colorPalette={STATE_TONE[sync.state] ?? "gray"}>
                {sync.state.replace(/_/g, " ").toLowerCase()}
              </Badge>
            </Table.Cell>
            <Table.Cell>
              {sync.lastPushedAtMs ? (
                formatDateTime(new Date(sync.lastPushedAtMs))
              ) : (
                <EmptyCell />
              )}
            </Table.Cell>
            <Table.Cell>
              {sync.lastFailure ? (
                <Text fontSize="sm">
                  {sync.lastFailure.op} · {sync.lastFailure.errorCode}
                </Text>
              ) : (
                <EmptyCell />
              )}
            </Table.Cell>
            <Table.Cell>{sync.deadLetters.length}</Table.Cell>
            <Table.Cell textAlign="right">
              <Box width="full" display="flex" justifyContent="end">
                <RowActions sync={sync} onOpen={onOpen} />
              </Box>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function RowActions({
  sync,
  onOpen,
}: {
  sync: SyncRow;
  onOpen: (connectionId: string) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${sync.organizationName ?? sync.connectionId}`}
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
            onOpen(sync.connectionId);
          }}
        >
          Open
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * One connection's sync, beside the list. The dead letters open here — each
 * one naming the intent that was retired, its reason code and how many
 * attempts it took before it stopped being retried — and so does the mapping
 * detail, which exists on this surface and on no other.
 */
function SyncDrawer({
  connectionId,
  onClose,
}: {
  connectionId: string | null;
  onClose: () => void;
}) {
  const sync = api.scimOversight.getById.useQuery(
    { connectionId: connectionId ?? "" },
    { enabled: !!connectionId, retry: false },
  );
  const identities = api.scimOversight.directoryIdentities.useQuery(
    { connectionId: connectionId ?? "" },
    { enabled: !!connectionId, retry: false },
  );
  const held = sync.data;

  return (
    <Drawer.Root
      open={!!connectionId}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
      size="xl"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {held?.organizationName ?? "Directory sync"}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {held && (
            <VStack align="stretch" gap={6}>
              <SyncFacts sync={held} />
              <DeadLetters sync={held} />
              <DirectoryIdentities rows={identities.data} />
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function SyncFacts({ sync }: { sync: SyncRow }) {
  return (
    <SimpleGrid columns={2} gap={3}>
      <Fact label="State">{sync.state.replace(/_/g, " ").toLowerCase()}</Fact>
      <Fact label="Connection">{sync.connectionId}</Fact>
      <Fact label="Organization">{sync.organizationId}</Fact>
      <Fact label="Last push">
        {sync.lastPushedAtMs
          ? formatDateTime(new Date(sync.lastPushedAtMs))
          : "never"}
      </Fact>
      <Fact label="Ended because">{sync.revokedCause ?? "still live"}</Fact>
      <Fact label="Standing failure">
        {sync.lastFailure
          ? `${sync.lastFailure.errorCode} (${sync.lastFailure.attempts} attempts)`
          : "none"}
      </Fact>
    </SimpleGrid>
  );
}

/**
 * The retired intents, with the retry history each one carries and the one
 * act this surface offers. The control is withheld from a letter that has
 * already been sent through — the act stands, and offering it again would
 * invite an operator to do a thing whose only answer is that it is done.
 */
function DeadLetters({ sync }: { sync: SyncRow }) {
  const utils = api.useContext();
  const redrive = api.scimOversight.redriveRetiredApply.useMutation({
    onSuccess: async (result) => {
      await utils.scimOversight.invalidate();
      toaster.create({
        title: result.applied
          ? "Sent through again"
          : "Already sent through, so nothing ran twice",
        type: "success",
        duration: 3000,
      });
    },
    onError: (error) => {
      showErrorToast({ error, fallbackTitle: "Couldn't send it through" });
    },
  });

  return (
    <Box>
      <Text fontWeight="semibold" marginBottom={2}>
        Retired applies
      </Text>
      {sync.deadLetters.length === 0 && (
        <Text color="fg.muted" fontSize="sm">
          Nothing has been retired for this connection.
        </Text>
      )}
      <VStack align="stretch" gap={3}>
        {sync.deadLetters.map((letter) => (
          <HStack key={`${letter.retiredAtMs}`} gap={3} align="start">
            <VStack align="start" gap={0}>
              <Text fontSize="sm">
                {letter.op} · {letter.errorCode}
              </Text>
              <Text fontSize="xs" color="fg.muted">
                {letter.attempts} attempts · retired{" "}
                {letter.retiredAtMs
                  ? formatDateTime(new Date(letter.retiredAtMs))
                  : "—"}
                {letter.userId ? ` · ${letter.userId}` : ""}
              </Text>
              {letter.redrivenAtMs && (
                <Text fontSize="xs" color="fg.muted">
                  sent through again{" "}
                  {formatDateTime(new Date(letter.redrivenAtMs))}
                </Text>
              )}
            </VStack>
            <Box flex="1" />
            {!letter.redrivenAtMs && letter.retiredAtMs !== null && (
              <Button
                size="xs"
                variant="outline"
                disabled={redrive.isPending}
                onClick={() =>
                  redrive.mutate({
                    connectionId: sync.connectionId,
                    retiredAtMs: letter.retiredAtMs as number,
                  })
                }
              >
                Send through again
              </Button>
            )}
          </HStack>
        ))}
      </VStack>
    </Box>
  );
}

/**
 * Which person the directory knows by which identifier. Operator-only: the
 * organization view has no query that answers it, and this is the row a
 * support case turns on when a push matched somebody unexpected.
 */
function DirectoryIdentities({
  rows,
}: {
  rows:
    | Array<{ externalId: string; userId: string; updatedAtMs: number }>
    | undefined;
}) {
  return (
    <Box>
      <Text fontWeight="semibold" marginBottom={2}>
        People this directory manages
      </Text>
      {(!rows || rows.length === 0) && (
        <Text color="fg.muted" fontSize="sm">
          This connection has not been told about anybody yet.
        </Text>
      )}
      <VStack align="stretch" gap={1}>
        {rows?.map((row) => (
          <HStack key={row.externalId} gap={3}>
            <Text fontSize="sm">{row.externalId}</Text>
            <Text fontSize="sm" color="fg.muted">
              {row.userId}
            </Text>
            <Box flex="1" />
            <Text fontSize="xs" color="fg.muted">
              {formatDateTime(new Date(row.updatedAtMs))}
            </Text>
          </HStack>
        ))}
      </VStack>
    </Box>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="sm">{children}</Text>
    </Box>
  );
}
