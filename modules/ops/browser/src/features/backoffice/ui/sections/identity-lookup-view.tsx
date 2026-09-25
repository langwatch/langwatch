import { Badge, Box, Button, Heading, HStack, Table, Text, VStack } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import type { IdentityLookupAnswer, LookupPerson } from "@langwatch/identity-contract";
import { nowInstant } from "@langwatch/time";
import { MoreVertical } from "lucide-react";
import { useState } from "react";
import { useDebounce } from "use-debounce";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../../behavior/ops-feedback.ts";
import { useOpsRouter } from "../../../../behavior/ops-router.ts";
import { shortenIdentifier, waitedFor } from "../../model/identity-lookup-copy.ts";
import { EmptyCell, formatDateTime } from "../elements/backoffice-cells.tsx";
import { ShortId } from "../elements/short-id.tsx";
import { BackofficeTable } from "./backoffice-table-shell.tsx";
import { IdentityLookupDrawer } from "./identity-lookup-drawer.tsx";

const COLUMN_COUNT = 4;

/**
 * The operator's identity lookup (D05): one address in, everybody holding it out.
 * Spec: specs/identity/platform-ops-identity-lookup.feature.
 */
export default function IdentityLookupView() {
  const router = useOpsRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search, 300);
  const address = debouncedSearch.trim();

  const openUserId = typeof router.query.person === "string" ? router.query.person : null;

  const lookup = api.identityLookup.resolve.useQuery(
    { address },
    { enabled: address.length > 0, retry: false },
  );

  const setOpenPerson = (userId: string | null) => {
    router.replace({ query: { ...router.query, person: userId ?? undefined } }, undefined, {
      shallow: true,
    });
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
        <VStack align="stretch" gap={8} width="full" padding={6}>
          {address.length === 0 && (
            <Text color="fg.muted">
              Type an email address to see how sign-in would route it, who holds it, and what is
              waiting on a human.
            </Text>
          )}
          {lookup.data && (
            <>
              <ResolvedAddress typed={lookup.data.typed} resolved={lookup.data.resolved} />
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

/** Both the typed and the resolved address: a normalization must be told apart from a typo. */
function ResolvedAddress({ typed, resolved }: { typed: string; resolved: string }) {
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

function RoutingPanel({ routing }: { routing: IdentityLookupAnswer["routing"] }) {
  return (
    <Box>
      <Heading size="sm" paddingBottom={2}>
        Routing
      </Heading>
      <VStack align="start" gap={2}>
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
    </Box>
  );
}

/** Everybody holding any part of the address: always a list, never a winner. */
function PeopleTable({
  people,
  canRepair,
  onOpen,
}: {
  people: readonly LookupPerson[];
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
                          organization.name ?? shortenIdentifier(organization.organizationId),
                      )
                      .join(", ")}
                  </Text>
                )}
              </Table.Cell>
              <Table.Cell>
                <Text fontSize="sm">
                  {person.holding.map((held) => `${held.provider} (${held.state})`).join(", ") || (
                    <EmptyCell />
                  )}
                </Text>
              </Table.Cell>
              <Table.Cell textAlign="right">
                <Box display="flex" justifyContent="end">
                  <PersonRowActions person={person} canRepair={canRepair} onOpen={onOpen} />
                </Box>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

/** Opening is always offered; repairs that name a method live in the drawer. */
function PersonRowActions({
  person,
  canRepair,
  onOpen,
}: {
  person: LookupPerson;
  canRepair: boolean;
  onOpen: (userId: string) => void;
}) {
  const utils = api.useContext();
  const toaster = useOpsToaster();
  const showErrorToast = useShowErrorToast();
  const endSessions = api.identityLookup.endSessions.useMutation({
    onSuccess: async () => {
      await utils.identityLookup.invalidate();
      toaster.create({ title: "Signed out everywhere", type: "success", duration: 3000 });
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't end the sessions" }),
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
              endSessions.mutate({ userId: person.userId, identifierId: null });
            }}
          >
            End every session
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

/** Domain claims awaiting a LangWatch decision, longest wait first, as the server orders them. */
function ClaimQueuePanel() {
  const queue = api.identityLookup.claimQueue.useQuery({}, { retry: false });
  const nowMs = nowInstant().epochMilliseconds;

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
            <HStack key={`${claim.connectionId}:${claim.domain}`} justify="space-between">
              <Text fontSize="sm">
                {claim.domain} · {claim.organizationName ?? shortenIdentifier(claim.organizationId)}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                waiting {waitedFor({ sinceMs: claim.waitingSinceMs, nowMs })} ·{" "}
                {formatDateTime(claim.waitingSinceMs)}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
}

/** The trail every lookup and repair writes to, read back. */
function OperatorActivityPanel() {
  const activity = api.identityLookup.recentActivity.useQuery({}, { retry: false });

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
                  (act.operatorUserId ? shortenIdentifier(act.operatorUserId) : "somebody")}{" "}
                · {act.act}
                {act.address ? ` · ${act.address}` : ""}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {formatDateTime(act.atMs)}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
}
