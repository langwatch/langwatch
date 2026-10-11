import { Dialog } from "@langwatch/design-system/dialog";
import { Drawer } from "@langwatch/design-system/drawer";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import {
  Badge,
  Box,
  Button,
  Field,
  HStack,
  Input,
  Skeleton,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import type { AdminSsoConnection, SsoSetupMigration } from "@langwatch/enterprise-sso-contract";
import { MoreVertical, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDebounce } from "use-debounce";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
import { useOpsRouter as useRouter } from "../../../../behavior/ops-router.ts";
import { useOpsHost } from "../../../../model/ops-host.ts";
import { AdminDate, EmptyCell } from "../elements/admin-cells.tsx";
import { AdminTable } from "./admin-table-shell.tsx";
import {
  ConnectionDomains,
  ConnectionHeaderBadges,
  ConnectionSummary,
  METHOD_LABEL,
  STATE_TONE,
} from "./sso-connection-details.tsx";
import { ConnectionHistory } from "./sso-connection-history.tsx";

/** The controls a failed submit can land on; wrappers that carry the state are skipped. */
const INVALID_CONTROL =
  'input[aria-invalid="true"], textarea[aria-invalid="true"], select[aria-invalid="true"]';
const PAGE_SIZE = 25;
const COLUMN_COUNT = 6;

/** SSO connections management (D05 tier 1). Uses the AdminTable shell; every action
 * is guarded command (offers verbs, not forms). Replaces org-record text inputs. */
export default function SsoConnectionsView() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const [page, setPage] = useState(1);
  const openConnectionId =
    typeof router.query.connection === "string" ? router.query.connection : null;

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
    router.replace({ query }, { shallow: true });
  };

  return (
    <>
      <AdminTable
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
        <ConnectionsTable connections={list.data?.connections} onOpen={setOpenConnection} />
      </AdminTable>

      <ConnectionDrawer connectionId={openConnectionId} onClose={() => setOpenConnection(null)} />
    </>
  );
}

type ConnectionRow = AdminSsoConnection;

function ConnectionsTable({
  connections,
  onOpen,
}: {
  connections: ConnectionRow[] | undefined;
  onOpen: (connectionId: string) => void;
}) {
  return (
    <ListTable density="compact" scroll="x" scrollLabel="Single sign-on connections table">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Organization</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>State</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Domains</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Proved by</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Last change</ListTable.ColumnHeader>
          <ListTable.ColumnHeader width={60} align="end" label="Actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {connections?.length === 0 && (
          <ListTable.SpanRow columns={COLUMN_COUNT}>
            <Text color="fg.muted" textAlign="center" paddingY={6}>
              No single sign-on connections match your search.
            </Text>
          </ListTable.SpanRow>
        )}
        {connections?.map((connection) => (
          <ListTable.Row
            key={connection.connectionId}
            onActivate={() => onOpen(connection.connectionId)}
          >
            <ListTable.Cell>
              <VStack align="start" gap={0}>
                {connection.organizationName ? (
                  <ListTable.RowAction onActivate={() => onOpen(connection.connectionId)}>
                    {connection.organizationName}
                  </ListTable.RowAction>
                ) : (
                  <EmptyCell />
                )}
                <Text fontSize="xs" color="fg.muted">
                  {connection.providerId}
                </Text>
              </VStack>
            </ListTable.Cell>
            <ListTable.Cell>
              <Badge colorPalette={STATE_TONE[connection.state] ?? "gray"}>
                {connection.state.replace(/_/g, " ").toLowerCase()}
              </Badge>
            </ListTable.Cell>
            <ListTable.Cell>
              <DomainSummary connection={connection} />
            </ListTable.Cell>
            <ListTable.Cell>
              <ProvedBy connection={connection} />
            </ListTable.Cell>
            <ListTable.Cell>
              <AdminDate value={connection.updatedAtMs} display="datetime" />
            </ListTable.Cell>
            <ListTable.Cell align="end">
              <Box width="full" height="full" display="flex" justifyContent="end">
                <RowActions connection={connection} onOpen={onOpen} />
              </Box>
            </ListTable.Cell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
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
      connection.domainVerifications.map((entry) => METHOD_LABEL[entry.method] ?? entry.method),
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

/** Verbs as data (derived, not rendered) so list mirrors state machine; unfamiliar
 * entries are rejected, not just hidden. */
function rowActionsFor({
  connection,
  commands,
  onOpen,
  onStartAttest,
  onStartRemoval,
}: {
  connection: ConnectionRow;
  commands: ReturnType<typeof useConnectionCommands>;
  onOpen: (connectionId: string) => void;
  onStartAttest: (domain: string) => void;
  onStartRemoval: () => void;
}): RowAction[] {
  const target = {
    organizationId: connection.organizationId,
    connectionId: connection.connectionId,
  };
  const claimed = connection.claimedDomains[0];
  const approved = connection.approvedDomains[0];
  const live = connection.state === "ACTIVE" || connection.state === "SUSPENDED";

  return [
    {
      value: "open",
      label: "Open",
      run: () => onOpen(connection.connectionId),
    },
    claimed && {
      value: "approve",
      label: `Approve ${claimed}`,
      run: () => commands.approveDomainClaim.mutate({ ...target, domain: claimed }),
    },
    approved && {
      value: "attest",
      label: `Vouch for ${approved}`,
      run: () => onStartAttest(approved),
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
  const [attesting, setAttesting] = useState<string | null>(null);
  const commands = useConnectionCommands();
  const actions = rowActionsFor({
    connection,
    commands,
    onOpen,
    onStartAttest: setAttesting,
    onStartRemoval: () => setRemoving(true),
  });

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Actions for ${connection.organizationName ?? connection.connectionId}`}
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

      <AttestDomainDialog
        domain={attesting}
        onClose={() => setAttesting(null)}
        onConfirm={({ evidenceRef, note }) => {
          if (!attesting) return;
          commands.attestDomain.mutate({
            organizationId: connection.organizationId,
            connectionId: connection.connectionId,
            domain: attesting,
            evidenceRef,
            note,
          });
          setAttesting(null);
        }}
      />

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

/** Vouching stands in for the customer proving the domain, so it records what proved it. */
function AttestDomainDialog({
  domain,
  onClose,
  onConfirm,
}: {
  domain: string | null;
  onClose: () => void;
  onConfirm: (evidence: { evidenceRef: string; note: string }) => void;
}) {
  const [evidenceRef, setEvidenceRef] = useState("");
  const [note, setNote] = useState("");
  const [attempts, setAttempts] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (domain) {
      setEvidenceRef("");
      setNote("");
      setAttempts(0);
    }
  }, [domain]);

  const problems = {
    evidenceRef: evidenceRef.trim() === "" ? "Say what evidence proves the domain." : void 0,
    note: note.trim() === "" ? "Explain why this evidence proves domain control." : void 0,
  };

  useEffect(() => {
    if (attempts === 0) return;
    formRef.current?.querySelector<HTMLElement>(INVALID_CONTROL)?.focus();
  }, [attempts]);

  const submit = () => {
    if (problems.evidenceRef || problems.note) {
      setAttempts((count) => count + 1);
      return;
    }
    onConfirm({ evidenceRef: evidenceRef.trim(), note: note.trim() });
  };

  return (
    <Dialog
      open={domain !== null}
      onClose={onClose}
      title={`Vouch for ${domain ?? ""}?`}
      onSubmit={submit}
      primaryAction={{ label: "Vouch for domain", type: "submit" }}
    >
      <VStack align="stretch" gap={3} ref={formRef}>
        <Text>
          Vouching confirms the customer controls {domain} without asking them to publish a record.
          Say what proved it, so anyone reading this connection later can check.
        </Text>
        <Field.Root invalid={attempts > 0 && problems.evidenceRef !== undefined}>
          <Field.Label>Evidence reference</Field.Label>
          <Input
            value={evidenceRef}
            onChange={(event) => setEvidenceRef(event.target.value)}
            placeholder="Ticket, contract, or verification record"
            aria-required
            aria-invalid={(attempts > 0 && problems.evidenceRef !== undefined) || undefined}
          />
          <Field.ErrorText>{problems.evidenceRef}</Field.ErrorText>
        </Field.Root>
        <Field.Root invalid={attempts > 0 && problems.note !== undefined}>
          <Field.Label>Why does this evidence prove domain control?</Field.Label>
          <Textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-required
            aria-invalid={(attempts > 0 && problems.note !== undefined) || undefined}
          />
          <Field.ErrorText>{problems.note}</Field.ErrorText>
        </Field.Root>
      </VStack>
    </Dialog>
  );
}

/** Names org by resolvable name to verify before removing; withheld if unresolvable
 * (on cross-tenant surface, risk is right action on wrong tenant). */
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
    <Dialog
      open={open}
      onClose={onClose}
      title={
        resolvable
          ? `Remove single sign-on for ${connection.organizationName}?`
          : "This organization cannot be identified"
      }
      primaryAction={
        resolvable
          ? {
              label: "Remove",
              danger: true,
              onClick: () => onConfirm(reason.trim() || null),
            }
          : void 0
      }
    >
      {resolvable ? (
        <VStack align="stretch" gap={3}>
          <Text>
            Everyone at {connection.organizationName} who signs in through{" "}
            {connection.verifiedDomains.join(", ")} loses that way in when the removal completes.
            Anyone who has no other verified sign-in method cannot get in at all, and the removal is
            refused until they do.
          </Text>
          <Text color="fg.muted" fontSize="sm">
            The connection stays reversible for seven days. Pausing it instead stops sign-ins
            immediately and can be undone at any time.
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
          The organization behind this connection could not be resolved, so there is no way to
          confirm which customer this would affect. Removal is unavailable until it can be.
        </Text>
      )}
    </Dialog>
  );
}

/**
 * Every mutation this surface has, in one place, each invalidating the list
 * and each reporting failure from the code-keyed registry rather than from a
 * wire message — which, for a handled error, is the code slug.
 */
function useConnectionCommands() {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
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
  const migration = api.ssoConnections.getMigrationProgress.useQuery(
    { connectionId: connectionId ?? "", cursor: null, limit: 50 },
    { enabled: !!connectionId, retry: false },
  );
  const held = connection.data;
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Drawer
      open={!!connectionId}
      onClose={onClose}
      size="detail"
      title={held?.providerId ?? "SSO connection"}
      eyebrow={{ label: "SSO connection", icon: <ShieldCheck size={14} aria-hidden /> }}
      badges={held ? <ConnectionHeaderBadges connection={held} /> : void 0}
      contentRef={contentRef}
      initialFocusEl={() => contentRef.current}
    >
      {connection.isLoading && <Skeleton height="32" />}
      {connection.error && <Text color="fg.error">This connection could not be loaded.</Text>}
      {!connection.isLoading && !connection.error && !held && (
        <Text color="fg.muted">This connection could not be found.</Text>
      )}
      {held && (
        <VStack align="stretch" gap={6}>
          <ConnectionSummary connection={held} />
          <ConnectionDomains connection={held} />
          {held.source === "legacy-grandfathered" && (
            <MigrationInventory connection={held} migration={migration.data ?? null} />
          )}
          {held.state === "VERIFIED" && <ActivationPanel connection={held} />}
          <ConnectionHistory connectionId={held.connectionId} />
        </VStack>
      )}
    </Drawer>
  );
}

/** A carried-over connection's replacement, and how far the cutover has come. */
function MigrationInventory({
  connection,
  migration,
}: {
  connection: ConnectionRow;
  migration: SsoSetupMigration | null;
}) {
  // Sso lends the import form (§10.1): ops draws it, sso owns it.
  const ImportReplacement = useOpsHost().ssoReplacementImport();
  return (
    <Box>
      <Text fontWeight="semibold" marginBottom={2}>
        Migration inventory
      </Text>
      <VStack align="stretch" gap={2}>
        {migration ? (
          <>
            <Text fontSize="sm">
              Replacement is in {migration.phase.toLowerCase()} with {migration.members.linkedCount}{" "}
              of {migration.members.activeCount} active members linked.
            </Text>
            <Text fontSize="sm" color="fg.muted">
              Route: {migration.selectedRoute}; SCIM: {migration.scim.status}.
            </Text>
            {migration.blockers.length > 0 && (
              <Text fontSize="sm" color="fg.muted">
                Waiting on: {migration.blockers.map((blocker) => blocker.message).join("; ")}
              </Text>
            )}
          </>
        ) : (
          <>
            <Text fontSize="sm" color="fg.muted">
              No replacement is registered. Import the customer's supplied OIDC or SAML
              configuration to begin the guarded migration.
            </Text>
            {ImportReplacement && (
              <ImportReplacement
                organizationId={connection.organizationId}
                replacesConnectionId={connection.connectionId}
              />
            )}
          </>
        )}
      </VStack>
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
        Someone at {connection.organizationName ?? "the organization"} completes a test sign-in
        first. Name the account whose sign-in you are turning this on against.
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
