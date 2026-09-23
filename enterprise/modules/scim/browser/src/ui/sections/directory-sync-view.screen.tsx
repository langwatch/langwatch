// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Directory sync across every customer, in the back office (ADR-122): the
 * reason code behind a failure, its attempts, the identifier mapping, and the
 * one write either surface has, sending a retired apply through again.
 */
import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  SimpleGrid,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { Menu } from "@langwatch/design-system/menu";
import { SearchInput } from "@langwatch/design-system/search-input";
import { ChevronLeft, ChevronRight, MoreVertical } from "lucide-react";
import { useState, type ReactNode } from "react";

import { scimApi, type OversightSyncRow } from "../../behavior/scim-api.ts";
import { useDebouncedValue } from "../../behavior/use-debounced-value.ts";
import {
  OPEN_CONNECTION_PARAM,
  redrivableAt,
  syncStatePalette,
  syncStateWords,
} from "../../model/directory-sync-oversight.ts";
import { readableDateTime } from "../../model/display-formatters.ts";
import { useScimHost } from "../../model/scim-host.ts";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 6;

export default function DirectorySyncView() {
  const host = useScimHost();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue({ value: search, delayMs: 300 });
  const [page, setPage] = useState(1);
  const query = host.route().query;
  const openConnectionId = query[OPEN_CONNECTION_PARAM] ?? null;

  const list = scimApi.scimOversight.getAll.useQuery({
    page: page - 1,
    pageSize: PAGE_SIZE,
    search: debouncedSearch.trim() || void 0,
  });

  const onSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const setOpenConnection = (connectionId: string | null) => {
    host.setQuery({ ...query, [OPEN_CONNECTION_PARAM]: connectionId ?? void 0 });
  };

  const total = list.data?.total ?? 0;

  return (
    <>
      <VStack gap={6} width="full" align="start">
        <Heading>Directory Sync</Heading>
        <SearchInput
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by connection, organization or state"
          width="full"
          maxWidth="480px"
        />
        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            <ListBody
              isError={list.isError}
              isLoading={list.isLoading}
              syncs={list.data?.syncs}
              onOpen={setOpenConnection}
            />
          </Card.Body>
        </Card.Root>
        {total > 0 && <Pagination page={page} total={total} onPageChange={setPage} />}
      </VStack>

      <SyncDrawer connectionId={openConnectionId} onClose={() => setOpenConnection(null)} />
    </>
  );
}

function ListBody({
  isError,
  isLoading,
  syncs,
  onOpen,
}: {
  isError: boolean;
  isLoading: boolean;
  syncs: OversightSyncRow[] | undefined;
  onOpen: (connectionId: string) => void;
}) {
  if (isError) {
    return (
      <Box paddingY={10} paddingX={4}>
        <Text color="fg.error">Couldn&apos;t load directory sync.</Text>
      </Box>
    );
  }
  if (isLoading) {
    return (
      <Box paddingY={10} textAlign="center">
        <Spinner size="md" />
      </Box>
    );
  }
  return <SyncsTable syncs={syncs} onOpen={onOpen} />;
}

function Pagination({
  page,
  total,
  onPageChange,
}: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE);

  return (
    <HStack width="full" justify="end" gap={4}>
      <Text fontSize="sm" color="fg.muted">
        {rangeStart}–{rangeEnd} of {total}
      </Text>
      <HStack gap={1}>
        <Button
          aria-label="Previous page"
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={14} />
        </Button>
        <Button
          aria-label="Next page"
          size="sm"
          variant="outline"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={14} />
        </Button>
      </HStack>
    </HStack>
  );
}

function SyncsTable({
  syncs,
  onOpen,
}: {
  syncs: OversightSyncRow[] | undefined;
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
            data-testid="directory-sync-row"
          >
            <Table.Cell>
              <VStack align="start" gap={0}>
                <Text>{sync.organizationName ?? "—"}</Text>
                <Text fontSize="xs" color="fg.muted">
                  {sync.connectionId}
                </Text>
              </VStack>
            </Table.Cell>
            <Table.Cell>
              <Badge colorPalette={syncStatePalette(sync.state)}>
                {syncStateWords(sync.state)}
              </Badge>
            </Table.Cell>
            <Table.Cell>
              {sync.lastPushedAtMs ? readableDateTime(sync.lastPushedAtMs) : "—"}
            </Table.Cell>
            <Table.Cell>
              {sync.lastFailure ? (
                <Text fontSize="sm">
                  {sync.lastFailure.op} · {sync.lastFailure.errorCode}
                </Text>
              ) : (
                "—"
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
  sync: OversightSyncRow;
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

/** One connection's sync beside the list: its dead letters and its identifier mapping. */
function SyncDrawer({
  connectionId,
  onClose,
}: {
  connectionId: string | null;
  onClose: () => void;
}) {
  const sync = scimApi.scimOversight.getById.useQuery(
    { connectionId: connectionId ?? "" },
    { enabled: !!connectionId, retry: false },
  );
  const identities = scimApi.scimOversight.directoryIdentities.useQuery(
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
          <Drawer.Title>{held?.organizationName ?? "Directory sync"}</Drawer.Title>
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

function SyncFacts({ sync }: { sync: OversightSyncRow }) {
  return (
    <SimpleGrid columns={2} gap={3}>
      <Fact label="State">{syncStateWords(sync.state)}</Fact>
      <Fact label="Connection">{sync.connectionId}</Fact>
      <Fact label="Organization">{sync.organizationId}</Fact>
      <Fact label="Last push">
        {sync.lastPushedAtMs ? readableDateTime(sync.lastPushedAtMs) : "never"}
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

/** The retired intents and the one act offered on them, withheld once it has been done. */
function DeadLetters({ sync }: { sync: OversightSyncRow }) {
  const host = useScimHost();
  const utils = scimApi.useUtils();
  const redrive = scimApi.scimOversight.redriveRetiredApply.useMutation({
    onSuccess: async (result) => {
      await utils.scimOversight.invalidate();
      host.succeeded({
        title: result.applied ? "Sent through again" : "Already sent through, so nothing ran twice",
      });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't send it through" }),
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
        {sync.deadLetters.map((letter) => {
          const retiredAtMs = redrivableAt(letter);
          return (
            <HStack key={`${letter.retiredAtMs}`} gap={3} align="start" data-testid="dead-letter">
              <VStack align="start" gap={0}>
                <Text fontSize="sm">
                  {letter.op} · {letter.errorCode}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {letter.attempts} attempts · retired{" "}
                  {letter.retiredAtMs ? readableDateTime(letter.retiredAtMs) : "—"}
                  {letter.userId ? ` · ${letter.userId}` : ""}
                </Text>
                {letter.redrivenAtMs && (
                  <Text fontSize="xs" color="fg.muted">
                    sent through again {readableDateTime(letter.redrivenAtMs)}
                  </Text>
                )}
              </VStack>
              <Box flex="1" />
              {retiredAtMs !== void 0 && (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={redrive.isPending}
                  onClick={() => redrive.mutate({ connectionId: sync.connectionId, retiredAtMs })}
                >
                  Send through again
                </Button>
              )}
            </HStack>
          );
        })}
      </VStack>
    </Box>
  );
}

/** Which person the directory knows by which identifier; operator-only. */
function DirectoryIdentities({
  rows,
}: {
  rows: { externalId: string; userId: string; updatedAtMs: number }[] | undefined;
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
              {readableDateTime(row.updatedAtMs)}
            </Text>
          </HStack>
        ))}
      </VStack>
    </Box>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="sm">{children}</Text>
    </Box>
  );
}
