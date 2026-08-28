import {
  Badge,
  Box,
  Button,
  HStack,
  SimpleGrid,
  Table,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import { useEffect, useState } from "react";
import { useDebounce } from "use-debounce";
import { Dialog } from "~/components/ui/dialog";
import { Drawer } from "~/components/ui/drawer";
import { Menu } from "@langwatch/design-system/menu";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { BackofficeTable, EmptyCell, formatDateTime } from "../BackofficeTable";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 6;

/**
 * The back office's single sign-on connections (D05 tier 1).
 *
 * It extends the back office rather than sitting beside it: the same
 * `BackofficeTable` shell, the same debounced search and paging, the same
 * per-row overflow menu, and a detail drawer that opens beside the list. What
 * is different is underneath — every action here is a guarded command with
 * the operator recorded on it, so this view holds no form that writes a
 * field. It offers verbs.
 *
 * This is what replaces the two free-text single sign-on inputs that used to
 * sit on the organization record.
 */
export default function SsoConnectionsView() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const openConnectionId =
    typeof router.query.connection === "string"
      ? router.query.connection
      : null;

  const list = api.ssoConnections.getAll.useQuery({
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
        title="Single Sign-On"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by connection, organization or domain"
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
        <ConnectionsTable
          connections={list.data?.connections}
          onOpen={setOpenConnection}
        />
      </BackofficeTable>

      <ConnectionDrawer
        connectionId={openConnectionId}
        onClose={() => setOpenConnection(null)}
      />
    </>
  );
}

/** How far through the lifecycle a connection is, at a glance. Colour tracks
 *  whether it is serving traffic, not how far along it is: an operator
 *  scanning this list is looking for what is live and what is stopped. */
const STATE_TONE: Record<string, string> = {
  ACTIVE: "green",
  SUSPENDED: "orange",
  TEARDOWN_PENDING: "orange",
  TORN_DOWN: "red",
  REJECTED: "red",
  DISCARDED: "gray",
};

const METHOD_LABEL: Record<string, string> = {
  "dns-txt": "Published record",
  "license-token": "Licence",
  "operator-attested": "Attested by LangWatch",
  "legacy-configuration": "Earlier configuration",
};

interface ConnectionRow {
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  state: string;
  verifiedDomains: string[];
  claimedDomains: string[];
  approvedDomains: string[];
  domainVerifications: {
    domain: string;
    method: string;
    actorId: string | null;
    verifiedAtMs: number;
  }[];
  providerId: string;
  issuer: string | null;
  type: string;
  source: string;
  allowsJit: boolean;
  testLoginAccountId: string | null;
  rejection: { domain: string; note: string } | null;
  pendingVerificationDomain: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

function ConnectionsTable({
  connections,
  onOpen,
}: {
  connections: ConnectionRow[] | undefined;
  onOpen: (connectionId: string) => void;
}) {
  return (
    <Table.Root variant="line" size="md" width="full">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Organization</Table.ColumnHeader>
          <Table.ColumnHeader>State</Table.ColumnHeader>
          <Table.ColumnHeader>Domains</Table.ColumnHeader>
          <Table.ColumnHeader>Proved by</Table.ColumnHeader>
          <Table.ColumnHeader>Last change</Table.ColumnHeader>
          <Table.ColumnHeader width="60px" textAlign="right" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {connections?.length === 0 && (
          <Table.Row>
            <Table.Cell colSpan={COLUMN_COUNT}>
              <Text color="fg.muted" textAlign="center" paddingY={6}>
                No single sign-on connections match your search.
              </Text>
            </Table.Cell>
          </Table.Row>
        )}
        {connections?.map((connection) => (
          <Table.Row
            key={connection.connectionId}
            cursor="pointer"
            _hover={{ backgroundColor: "bg.muted" }}
            onClick={() => onOpen(connection.connectionId)}
          >
            <Table.Cell>
              <VStack align="start" gap={0}>
                <Text>{connection.organizationName ?? <EmptyCell />}</Text>
                <Text fontSize="xs" color="fg.muted">
                  {connection.providerId}
                </Text>
              </VStack>
            </Table.Cell>
            <Table.Cell>
              <Badge colorPalette={STATE_TONE[connection.state] ?? "gray"}>
                {connection.state.replace(/_/g, " ").toLowerCase()}
              </Badge>
            </Table.Cell>
            <Table.Cell>
              <DomainSummary connection={connection} />
            </Table.Cell>
            <Table.Cell>
              <ProvedBy connection={connection} />
            </Table.Cell>
            <Table.Cell>
              {formatDateTime(new Date(connection.updatedAtMs))}
            </Table.Cell>
            <Table.Cell textAlign="right">
              <Box
                width="full"
                height="full"
                display="flex"
                justifyContent="end"
              >
                <RowActions connection={connection} onOpen={onOpen} />
              </Box>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function DomainSummary({ connection }: { connection: ConnectionRow }) {
  if (connection.verifiedDomains.length > 0) {
    return <Text>{connection.verifiedDomains.join(", ")}</Text>;
  }
  const waiting = [...connection.approvedDomains, ...connection.claimedDomains];
  if (waiting.length === 0) return <EmptyCell />;
  return (
    <VStack align="start" gap={0}>
      <Text>{waiting.join(", ")}</Text>
      <Text fontSize="xs" color="fg.muted">
        not proved yet
      </Text>
    </VStack>
  );
}

/**
 * What proved each verified domain. An attested domain says so wherever it is
 * read — that is the price of an attestation standing indefinitely, and this
 * column is where it is paid on the list.
 */
function ProvedBy({ connection }: { connection: ConnectionRow }) {
  if (connection.domainVerifications.length === 0) return <EmptyCell />;
  const methods = [
    ...new Set(
      connection.domainVerifications.map(
        (entry) => METHOD_LABEL[entry.method] ?? entry.method,
      ),
    ),
  ];
  return <Text fontSize="sm">{methods.join(", ")}</Text>;
}

/** Which verbs the lifecycle admits from here. The menu offers what the
 *  aggregate would accept, so an operator is never shown a control whose only
 *  possible answer is a refusal. */
interface RowAction {
  value: string;
  label: string;
  destructive?: boolean;
  run: () => void;
}

/**
 * Which verbs the lifecycle admits from this row, as data. Derived rather
 * than rendered inline so that "what may be done from this state" is one
 * readable list beside the state machine it mirrors, and an entry that is not
 * in the list is not merely hidden — it was never offered.
 */
function rowActionsFor({
  connection,
  commands,
  onOpen,
  onStartRemoval,
}: {
  connection: ConnectionRow;
  commands: ReturnType<typeof useConnectionCommands>;
  onOpen: (connectionId: string) => void;
  onStartRemoval: () => void;
}): RowAction[] {
  const target = {
    organizationId: connection.organizationId,
    connectionId: connection.connectionId,
  };
  const claimed = connection.claimedDomains[0];
  const approved = connection.approvedDomains[0];
  const live =
    connection.state === "ACTIVE" || connection.state === "SUSPENDED";

  return [
    {
      value: "open",
      label: "Open",
      run: () => onOpen(connection.connectionId),
    },
    claimed && {
      value: "approve",
      label: `Approve ${claimed}`,
      run: () =>
        commands.approveDomainClaim.mutate({ ...target, domain: claimed }),
    },
    approved && {
      value: "attest",
      label: `Vouch for ${approved}`,
      run: () => commands.attestDomain.mutate({ ...target, domain: approved }),
    },
    connection.state === "VERIFIED" && {
      value: "activate",
      // Activation needs the account that completed the test sign-in, which
      // is a value to type — so the menu opens the drawer rather than
      // pretending one click is enough.
      label: "Turn on",
      run: () => onOpen(connection.connectionId),
    },
    connection.state === "ACTIVE" && {
      value: "suspend",
      label: "Pause",
      run: () => commands.suspend.mutate({ ...target, reason: null }),
    },
    connection.state === "SUSPENDED" && {
      value: "resume",
      label: "Resume",
      run: () => commands.resume.mutate(target),
    },
    live && {
      value: "remove",
      label: "Remove",
      destructive: true,
      run: onStartRemoval,
    },
  ].filter((action): action is RowAction => Boolean(action));
}

function RowActions({
  connection,
  onOpen,
}: {
  connection: ConnectionRow;
  onOpen: (connectionId: string) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const commands = useConnectionCommands();
  const actions = rowActionsFor({
    connection,
    commands,
    onOpen,
    onStartRemoval: () => setRemoving(true),
  });

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Actions for ${
              connection.organizationName ?? connection.connectionId
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          {actions.map((action) => (
            <Menu.Item
              key={action.value}
              value={action.value}
              color={action.destructive ? "fg.error" : undefined}
              onClick={(event) => {
                // The row itself opens the drawer on click, so every item
                // has to stop the event reaching it.
                event.stopPropagation();
                action.run();
              }}
            >
              {action.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Root>

      <RemoveConnectionDialog
        connection={connection}
        open={removing}
        onClose={() => setRemoving(false)}
        onConfirm={(reason) => {
          commands.requestTeardown.mutate({
            organizationId: connection.organizationId,
            connectionId: connection.connectionId,
            reason,
          });
          setRemoving(false);
        }}
      />
    </>
  );
}

/**
 * Removing a live connection states its own risk before it happens.
 *
 * The confirmation names the organization the way an operator can check it —
 * by name — and says who would lose their way in. When the name cannot be
 * resolved the control is withheld entirely rather than confirmed against an
 * identifier nobody can verify at a glance: on a cross-tenant surface the
 * risk is not the wrong action, it is the right action on the wrong tenant.
 */
function RemoveConnectionDialog({
  connection,
  open,
  onClose,
  onConfirm,
}: {
  connection: ConnectionRow;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const resolvable = Boolean(connection.organizationName);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Content onClick={(event) => event.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>
            {resolvable
              ? `Remove single sign-on for ${connection.organizationName}?`
              : "This organization cannot be identified"}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {resolvable ? (
            <VStack align="stretch" gap={3}>
              <Text>
                Everyone at {connection.organizationName} who signs in through{" "}
                {connection.verifiedDomains.join(", ")} loses that way in when
                the removal completes. Anyone who has no other verified sign-in
                method cannot get in at all, and the removal is refused until
                they do.
              </Text>
              <Text color="fg.muted" fontSize="sm">
                The connection stays reversible for seven days. Pausing it
                instead stops sign-ins immediately and can be undone at any
                time.
              </Text>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this being removed?"
                aria-label="Reason for removal"
              />
            </VStack>
          ) : (
            <Text>
              The organization behind this connection could not be resolved, so
              there is no way to confirm which customer this would affect.
              Removal is unavailable until it can be.
            </Text>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {resolvable && (
            <Button
              colorPalette="red"
              onClick={() => onConfirm(reason.trim() || null)}
            >
              Remove
            </Button>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * Every mutation this surface has, in one place, each invalidating the list
 * and each reporting failure from the code-keyed registry rather than from a
 * wire message — which, for a handled error, is the code slug.
 */
function useConnectionCommands() {
  const utils = api.useContext();
  const onSuccess = (title: string) => async () => {
    await utils.ssoConnections.invalidate();
    toaster.create({ title, type: "success", duration: 3000 });
  };
  const onError = (fallbackTitle: string) => (error: unknown) => {
    showErrorToast({ error, fallbackTitle });
  };

  return {
    approveDomainClaim: api.ssoConnections.approveDomainClaim.useMutation({
      onSuccess: onSuccess("Domain claim approved"),
      onError: onError("Couldn't approve the domain claim"),
    }),
    rejectDomainClaim: api.ssoConnections.rejectDomainClaim.useMutation({
      onSuccess: onSuccess("Domain claim rejected"),
      onError: onError("Couldn't reject the domain claim"),
    }),
    attestDomain: api.ssoConnections.attestDomain.useMutation({
      onSuccess: onSuccess("Domain vouched for"),
      onError: onError("Couldn't vouch for the domain"),
    }),
    activate: api.ssoConnections.activate.useMutation({
      onSuccess: onSuccess("Connection is live"),
      onError: onError("Couldn't turn the connection on"),
    }),
    suspend: api.ssoConnections.suspend.useMutation({
      onSuccess: onSuccess("Connection paused"),
      onError: onError("Couldn't pause the connection"),
    }),
    resume: api.ssoConnections.resume.useMutation({
      onSuccess: onSuccess("Connection resumed"),
      onError: onError("Couldn't resume the connection"),
    }),
    requestTeardown: api.ssoConnections.requestTeardown.useMutation({
      onSuccess: onSuccess("Removal started"),
      onError: onError("Couldn't remove the connection"),
    }),
  };
}

/**
 * The connection's detail, beside the list rather than on a page of its own.
 * State, domains, the identity provider reference and the history of what
 * proved each domain — which is where a dispute about a domain is answered.
 */
function ConnectionDrawer({
  connectionId,
  onClose,
}: {
  connectionId: string | null;
  onClose: () => void;
}) {
  const connection = api.ssoConnections.getById.useQuery(
    { connectionId: connectionId ?? "" },
    { enabled: !!connectionId, retry: false },
  );
  const held = connection.data;

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
            {held?.organizationName ?? "Single sign-on connection"}
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          {held && (
            <VStack align="stretch" gap={6}>
              <ConnectionFacts connection={held} />
              <ConnectionDomains connection={held} />
              {held.state === "VERIFIED" && (
                <ActivationPanel connection={held} />
              )}
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function ConnectionFacts({ connection }: { connection: ConnectionRow }) {
  return (
    <SimpleGrid columns={2} gap={3}>
      <Fact label="State">
        {connection.state.replace(/_/g, " ").toLowerCase()}
      </Fact>
      <Fact label="Protocol">{connection.type.toUpperCase()}</Fact>
      <Fact label="Identity provider">{connection.providerId}</Fact>
      <Fact label="Issuer">{connection.issuer ?? "not recorded"}</Fact>
      <Fact label="Set up">
        {connection.source === "legacy-grandfathered"
          ? "Carried over from an earlier configuration"
          : "In the back office"}
      </Fact>
      <Fact label="New people provisioned on first sign-in">
        {connection.allowsJit ? "Yes" : "No"}
      </Fact>
    </SimpleGrid>
  );
}

/**
 * Each domain and what proved it, naming the operator and the date for an
 * attested one — this is where a dispute about a domain is answered, and the
 * reason an attestation is allowed to stand indefinitely.
 */
function ConnectionDomains({ connection }: { connection: ConnectionRow }) {
  return (
    <Box>
      <Text fontWeight="semibold" marginBottom={2}>
        Domains
      </Text>
      {connection.domainVerifications.length === 0 && (
        <Text color="fg.muted" fontSize="sm">
          No domain has been proved yet.
        </Text>
      )}
      <VStack align="stretch" gap={2}>
        {connection.domainVerifications.map((entry) => (
          <HStack key={entry.domain} gap={3}>
            <Text>{entry.domain}</Text>
            <Badge colorPalette="gray">
              {METHOD_LABEL[entry.method] ?? entry.method}
            </Badge>
            <Text fontSize="sm" color="fg.muted">
              {formatDateTime(new Date(entry.verifiedAtMs))}
              {entry.actorId ? ` by ${entry.actorId}` : ""}
            </Text>
          </HStack>
        ))}
      </VStack>
      {connection.claimedDomains.length > 0 && (
        <Text fontSize="sm" color="fg.muted" marginTop={2}>
          Waiting for a decision: {connection.claimedDomains.join(", ")}
        </Text>
      )}
      {connection.approvedDomains.length > 0 && (
        <Text fontSize="sm" color="fg.muted" marginTop={2}>
          Approved, not yet proved: {connection.approvedDomains.join(", ")}
        </Text>
      )}
      {connection.rejection && (
        <Text fontSize="sm" color="fg.muted" marginTop={2}>
          {connection.rejection.domain} was turned down:{" "}
          {connection.rejection.note}
        </Text>
      )}
    </Box>
  );
}

/**
 * The last step, and the only one that still needs the customer: somebody
 * completing a test sign-in. The account that did it is named on the
 * activation, so the connection records what it was turned on against.
 */
function ActivationPanel({ connection }: { connection: ConnectionRow }) {
  const commands = useConnectionCommands();
  const [testLoginAccountId, setTestLoginAccountId] = useState("");

  return (
    <Box>
      <Text fontWeight="semibold" marginBottom={2}>
        Turn this connection on
      </Text>
      <Text fontSize="sm" color="fg.muted" marginBottom={2}>
        Someone at {connection.organizationName ?? "the organization"} completes
        a test sign-in first. Name the account whose sign-in you are turning
        this on against.
      </Text>
      <HStack>
        <Textarea
          value={testLoginAccountId}
          onChange={(event) => setTestLoginAccountId(event.target.value)}
          aria-label="Account that completed the test sign-in"
          rows={1}
        />
        <Button
          disabled={!testLoginAccountId.trim()}
          onClick={() =>
            commands.activate.mutate({
              organizationId: connection.organizationId,
              connectionId: connection.connectionId,
              testLoginAccountId: testLoginAccountId.trim(),
            })
          }
        >
          Turn on
        </Button>
      </HStack>
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
