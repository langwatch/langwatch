import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import { useState } from "react";
import { useDebounce } from "use-debounce";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { signInRoutingReasonCopy } from "~/features/auth/logic/routingReasonCopy";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { BackofficeTable, EmptyCell, formatDateTime } from "../BackofficeTable";
import { IdentityLookupDrawer } from "./IdentityLookupDrawer";
import { shortenIdentifier, waitedFor } from "./identityLookupCopy";
import { ShortId } from "./ShortId";

const COLUMN_COUNT = 4;

/**
 * The platform operator's identity lookup (D05) — the page that is meant to
 * end database surgery.
 *
 * It extends the back office rather than opening a new kind of surface: the
 * same `BackofficeTable` shell, the same debounced search, the same per-row
 * overflow menu, the same drawer beside the list. What is different is
 * underneath. Resolving an address here crosses every organization on the
 * installation, so the READ is authorized and recorded before it answers —
 * which is why the search is a query with an address in it rather than a
 * page that loads a list.
 *
 * There is no pagination: the input is one address, and the answer is
 * everybody who holds any part of it, which is a handful of rows or a data
 * problem. The claims queue below it is the one list on this page, and it is
 * bounded server-side.
 */
export default function IdentityLookupView() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const address = debouncedSearch.trim();

  const openUserId =
    typeof router.query.person === "string" ? router.query.person : null;

  const lookup = api.identityLookup.resolve.useQuery(
    { address },
    { enabled: address.length > 0, retry: false },
  );

  const setOpenPerson = (userId: string | null) => {
    const query = { ...router.query } as Record<string, unknown>;
    if (userId) {
      query.person = userId;
    } else {
      delete query.person;
    }
    void router.replace({ query }, undefined, { shallow: true });
  };

  return (
    <>
      <BackofficeTable
        title="Identity Lookup"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Type the email address the support case is about"
        isLoading={address.length > 0 && lookup.isLoading}
        isFetching={lookup.isFetching}
        error={lookup.error}
      >
        <VStack align="stretch" gap={6} width="full">
          {address.length === 0 && (
            <Text color="fg.muted">
              Type an email address to see how the auth screens would route it,
              who holds it, and what is waiting on a human.
            </Text>
          )}
          {lookup.data && (
            <>
              <ResolvedAddress
                typed={lookup.data.typed}
                resolved={lookup.data.resolved}
              />
              <RoutingPanel routing={lookup.data.routing} />
              <PeopleTable
                people={lookup.data.people}
                canRepair={lookup.data.canRepair}
                onOpen={setOpenPerson}
              />
            </>
          )}
          <ClaimQueuePanel />
          <OperatorActivityPanel />
        </VStack>
      </BackofficeTable>

      <IdentityLookupDrawer
        userId={openUserId}
        address={address}
        canRepair={lookup.data?.canRepair ?? false}
        onClose={() => setOpenPerson(null)}
      />
    </>
  );
}

/**
 * What was typed and what it resolved to, both on screen.
 *
 * Not decoration: the auth screens lowercases and folds an address before it
 * routes on it, and an operator pasting one out of a mail client is often
 * holding a form of it that never existed in the database. Showing only the
 * resolved value would leave them unable to tell a normalization from a typo.
 */
function ResolvedAddress({
  typed,
  resolved,
}: {
  typed: string;
  resolved: string;
}) {
  return (
    <HStack gap={2} fontSize="sm" wrap="wrap">
      <Text color="fg.muted">You typed</Text>
      <Text fontWeight="medium">{typed}</Text>
      <Text color="fg.muted">· resolved to</Text>
      <Text fontWeight="medium" data-testid="resolved-address">
        {resolved}
      </Text>
    </HStack>
  );
}

interface RoutingAnswer {
  outcome: string;
  reasonCode: string;
  connectionId: string | null;
  methods: readonly string[];
  connection: {
    connectionId: string;
    organizationId: string;
    organizationName: string | null;
    state: string;
    providerId: string;
  } | null;
}

/**
 * What the auth screens would decide, and the words it would have said.
 *
 * The decision comes from the router itself — the same function the sign-in
 * screen calls — and the copy comes from the auth screens' own reason
 * registry, so what an operator reads here is what the person read. A second
 * table of words would be right until the day it mattered.
 */
function RoutingPanel({ routing }: { routing: RoutingAnswer }) {
  const guidance = signInRoutingReasonCopy(routing.reasonCode);
  return (
    <Card.Root>
      <Card.Body>
        <VStack align="start" gap={2}>
          <Heading size="sm">Routing</Heading>
          <HStack gap={2} wrap="wrap">
            <Badge colorPalette="blue">
              {routing.outcome === "redirect_to_connection"
                ? "Sent to the identity provider"
                : "Shown the sign-in methods"}
            </Badge>
            <Text fontSize="sm" color="fg.muted">
              because
            </Text>
            <Badge variant="outline" data-testid="routing-reason">
              {routing.reasonCode}
            </Badge>
          </HStack>
          {guidance ? (
            <Box>
              <Text fontWeight="medium">{guidance.title}</Text>
              <Text fontSize="sm" color="fg.muted">
                {guidance.describe}
              </Text>
            </Box>
          ) : (
            <Text fontSize="sm" color="fg.muted">
              Nothing is said on screen for this decision — the person sees the
              ordinary sign-in.
            </Text>
          )}
          {routing.methods.length > 0 && (
            <Text fontSize="sm" color="fg.muted">
              Offered: {routing.methods.join(", ")}
            </Text>
          )}
          {routing.connection && (
            <Text fontSize="sm" data-testid="routing-connection">
              Connection{" "}
              {routing.connection.organizationName ??
                shortenIdentifier(routing.connection.organizationId)}{" "}
              ({routing.connection.providerId}) is{" "}
              {routing.connection.state.replace(/_/g, " ").toLowerCase()}.
            </Text>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

interface Person {
  userId: string;
  name: string | null;
  email: string | null;
  organizations: readonly {
    organizationId: string;
    name: string | null;
    role: string;
  }[];
  holding: readonly {
    identifierId: string;
    provider: string;
    state: string;
  }[];
}

/**
 * Everybody holding any part of the address.
 *
 * Always a list, never a winner. A support case where one row holds the
 * address as a proved method and another holds it detached is the case this
 * page exists for, and presenting either as "the" answer is how the wrong
 * account gets repaired.
 */
function PeopleTable({
  people,
  canRepair,
  onOpen,
}: {
  people: readonly Person[];
  canRepair: boolean;
  onOpen: (userId: string) => void;
}) {
  return (
    <Box>
      <Heading size="sm" paddingBottom={2}>
        People holding this address
      </Heading>
      <Table.Root variant="line" size="md" width="full">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Person</Table.ColumnHeader>
            <Table.ColumnHeader>Organizations</Table.ColumnHeader>
            <Table.ColumnHeader>Holds it as</Table.ColumnHeader>
            <Table.ColumnHeader width="60px" textAlign="right" />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {people.length === 0 && (
            <Table.Row>
              <Table.Cell colSpan={COLUMN_COUNT}>
                <Text color="fg.muted" paddingY={4}>
                  Nobody holds this address.
                </Text>
              </Table.Cell>
            </Table.Row>
          )}
          {people.map((person) => (
            <Table.Row
              key={person.userId}
              cursor="pointer"
              _hover={{ backgroundColor: "bg.muted" }}
              onClick={() => onOpen(person.userId)}
            >
              <Table.Cell>
                <VStack align="start" gap={0}>
                  <Text>{person.name ?? person.email ?? <EmptyCell />}</Text>
                  <ShortId id={person.userId} />
                </VStack>
              </Table.Cell>
              <Table.Cell>
                {person.organizations.length === 0 ? (
                  <EmptyCell />
                ) : (
                  <Text>
                    {person.organizations
                      .map(
                        (organization) =>
                          organization.name ??
                          shortenIdentifier(organization.organizationId),
                      )
                      .join(", ")}
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell>
                <Text fontSize="sm">
                  {person.holding
                    .map((held) => `${held.provider} (${held.state})`)
                    .join(", ") || <EmptyCell />}
                </Text>
              </Table.Cell>
              <Table.Cell textAlign="right">
                <Box display="flex" justifyContent="end">
                  <PersonRowActions
                    person={person}
                    canRepair={canRepair}
                    onOpen={onOpen}
                  />
                </Box>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

/**
 * The row's verbs.
 *
 * "Open" is always there because reading is what this page is for. The
 * repairs live inside the drawer, where the panels that name their targets
 * live — offering "detach a method" from a row that has not said WHICH
 * method would be a confirmation against something the operator has not
 * read.
 */
function PersonRowActions({
  person,
  canRepair,
  onOpen,
}: {
  person: Person;
  canRepair: boolean;
  onOpen: (userId: string) => void;
}) {
  const utils = api.useContext();
  const endSessions = api.identityLookup.endSessions.useMutation({
    onSuccess: async () => {
      await utils.identityLookup.invalidate();
      toaster.create({
        title: "Signed out everywhere",
        type: "success",
        duration: 3000,
      });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't end the sessions" }),
  });

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${person.name ?? person.userId}`}
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
            onOpen(person.userId);
          }}
        >
          Open
        </Menu.Item>
        {canRepair && (
          <Menu.Item
            value="end-sessions"
            color="fg.error"
            onClick={(event) => {
              event.stopPropagation();
              endSessions.mutate({
                userId: person.userId,
                identifierId: null,
              });
            }}
          >
            End every session
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * Domain claims awaiting a LangWatch decision, longest wait first.
 *
 * The claims themselves belong to the connection aggregate; this panel only
 * reads them and links out to the connection surface that decides them. It
 * says how long each has waited because that is the only thing a queue is
 * ever really asked.
 */
function ClaimQueuePanel() {
  const queue = api.identityLookup.claimQueue.useQuery({}, { retry: false });
  const nowMs = Date.now();

  return (
    <Box>
      <Heading size="sm" paddingBottom={2}>
        Domain claims awaiting review
      </Heading>
      {queue.data?.length === 0 ? (
        <Text color="fg.muted" fontSize="sm" data-testid="claim-queue-empty">
          Nothing is waiting.
        </Text>
      ) : (
        <VStack align="stretch" gap={1}>
          {queue.data?.map((claim) => (
            <HStack
              key={`${claim.connectionId}:${claim.domain}`}
              justify="space-between"
            >
              <Text fontSize="sm">
                {claim.domain} ·{" "}
                {claim.organizationName ??
                  shortenIdentifier(claim.organizationId)}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                waiting {waitedFor({ sinceMs: claim.waitingSinceMs, nowMs })} ·{" "}
                {formatDateTime(new Date(claim.waitingSinceMs))}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
}

/**
 * What operators have done on this surface recently.
 *
 * The same trail the repairs write to, read back: reads and writes are rows
 * in one audit table under one action prefix, so "who resolved this address"
 * and "who repaired this person" are answered together and in one order.
 * This panel is the reason the read is recorded at all — a record nobody can
 * read is a record nobody checks.
 */
function OperatorActivityPanel() {
  const activity = api.identityLookup.recentActivity.useQuery(
    {},
    { retry: false },
  );

  return (
    <Box>
      <Heading size="sm" paddingBottom={2}>
        What operators have done recently
      </Heading>
      {activity.data?.length === 0 ? (
        <Text color="fg.muted" fontSize="sm">
          Nothing has been looked up yet.
        </Text>
      ) : (
        <VStack align="stretch" gap={1} data-testid="operator-activity">
          {activity.data?.map((act) => (
            <HStack key={act.auditId} justify="space-between">
              <Text fontSize="sm">
                {act.operatorName ??
                  (act.operatorUserId
                    ? shortenIdentifier(act.operatorUserId)
                    : "somebody")}{" "}
                · {act.act}
                {act.address ? ` · ${act.address}` : ""}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {formatDateTime(new Date(act.atMs))}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
}
