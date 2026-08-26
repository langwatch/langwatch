import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  SimpleGrid,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plug } from "lucide-react";
import type { ReactNode } from "react";
import { IdentityChip } from "~/components/access/IdentityRow";
import { isRunningConnection } from "~/features/directory/logic/connectionLifecycle";
import type { OrganizationReconciliation } from "~/server/app-layer/identity/scim-reconciliation.service";
import { api } from "../../utils/api";
import RouterLink from "../../utils/compat/next-link";
import { DirectoryRequestsPanel } from "./DirectoryRequestsPanel";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { SettingsEmptyState } from "./SettingsEmptyState";

/**
 * What the directory has been doing, on the organization's own SCIM page
 * (ADR-122).
 *
 * A READ, and permanently so. Every word here comes from the server, which
 * built it from the sync projection, the mapping count and the grants facts
 * the directory authored — the page has no copy of its own to drift, and no
 * control that writes. In particular there is no retry: a failed apply is put
 * right by the directory's next push, which re-asserts everything the
 * directory still believes, and the remediation line says so where a button
 * would have been.
 *
 * Seeing this takes `sso:view`. Managing tokens and group mappings takes
 * `sso:manage` and lives elsewhere on the page, so a reader who may see and
 * not manage gets the whole panel and none of the controls.
 */
export function ScimReconciliationPanel({
  organizationId,
  maySetUpSingleSignOn,
}: {
  organizationId: string;
  /** `sso:manage`. Whether the reader is the person who could act on an empty
   *  directory, which decides whether the empty state carries the first step
   *  or only says who does. A control somebody will be refused for is still an
   *  invitation, and this page offers none of those. */
  maySetUpSingleSignOn: boolean;
}) {
  const reconciliation = api.scimReconciliation.getAll.useQuery({
    organizationId,
  });

  if (reconciliation.isLoading) {
    // Three hairline rows, the shape the reconciliation list takes when it
    // arrives — a wait that already looks like the answer.
    return (
      <VStack align="stretch" gap={0} data-testid="scim-reconciliation-loading">
        {[0, 1, 2].map((row) => (
          <HStack
            key={row}
            justify="space-between"
            paddingY={2.5}
            borderBottomWidth={row < 2 ? "1px" : "0"}
            borderColor="border.muted"
          >
            <Skeleton height="3.5" width="36" />
            <Skeleton height="3.5" width="16" />
          </HStack>
        ))}
      </VStack>
    );
  }

  const connections = reconciliation.data?.connections ?? [];
  const recentChanges = reconciliation.data?.recentChanges ?? [];

  return (
    <VStack gap={6} width="full" align="stretch">
      <VStack gap={3} width="full" align="stretch">
        <Heading size="sm">Connections</Heading>
        {connections.length === 0 && (
          <NoConnectionYet maySetUp={maySetUpSingleSignOn} />
        )}
        {connections.filter(isRunningConnection).map((connection) => (
          <ConnectionCard
            key={connection.connectionId}
            connection={connection}
            organizationId={organizationId}
          />
        ))}
        {/* A connection that has left is not one of the connections. It stays
            on the page — the people it provisioned are still here, and that
            is exactly the question somebody has when they find it — but under
            its own heading and dimmed, so a list of four cannot be read as
            four working directories. */}
        <RetiredConnections
          connections={connections.filter(
            (connection) => !isRunningConnection(connection),
          )}
        />
      </VStack>

      <RecentDirectoryChanges changes={recentChanges} />
    </VStack>
  );
}

/**
 * A directory with nothing in it, said as the step that would fill it.
 *
 * It was a paragraph. The paragraph was true — provisioning runs against a
 * connection, and there is no connection — and it left the reader holding a
 * fact with nowhere to take it, on a page that had already told them twice
 * that nothing was set up. An empty screen is an invitation to act, so the
 * state that has no data is the one state that carries the door.
 *
 * The door is Authentication, because that is where a connection is
 * registered; it is offered only to the reader who could walk through it.
 */
function NoConnectionYet({ maySetUp }: { maySetUp: boolean }) {
  return (
    <SettingsEmptyState
      dashed
      icon={<Plug size={20} />}
      title="No identity provider is connected yet"
      description="Provisioning runs against a single sign-on connection, so connecting one is the first step. After that your identity provider creates, updates and removes people here on its own."
      action={
        maySetUp ? (
          <Button asChild size="sm" colorPalette="orange">
            <RouterLink href="/settings/authentication">
              Set up single sign-on
            </RouterLink>
          </Button>
        ) : (
          <Text fontSize="xs" color="fg.muted">
            An administrator who manages single sign-on sets this up.
          </Text>
        )
      }
      testId="directory-no-connection"
    />
  );
}

/**
 * Taken from the SERVICE's own return type rather than inferred back out of
 * the query hook. The permission-checked procedure builder re-implements
 * tRPC's typing (see `permission` in `server/api/trpc.ts`) and does not thread
 * the handler's output through, so the hook's `data` widens to `{}` and every
 * index into it is a compile error. A type-only import is erased, so this
 * crosses no server/client boundary.
 */
type Reconciliation = OrganizationReconciliation;
type ConnectionPanel = Reconciliation["connections"][number];

/**
 * The connections that are history, said as history.
 *
 * KEPT, NOT HIDDEN — but FOLDED. The accounts a withdrawn connection
 * provisioned are still members of this organization, so a reader who removes
 * a connection and then asks "where did those forty people come from" needs to
 * find it. What they do not need is four dead connections and a paragraph
 * about them standing open under the one connection that works: an
 * organization that has been set up a few times reads as an organization with
 * five directories, and the live one is the last thing on the page.
 *
 * So it opens closed, with the count in the summary. The count is the whole
 * question somebody scanning has — "is there anything down there" — and it is
 * answered without opening it.
 */
function RetiredConnections({
  connections,
}: {
  connections: ConnectionPanel[];
}) {
  if (connections.length === 0) return null;
  return (
    <SettingsDisclosure summary={`No longer connected (${connections.length})`}>
      <RetiredConnectionList connections={connections} />
    </SettingsDisclosure>
  );
}

function RetiredConnectionList({
  connections,
}: {
  connections: ConnectionPanel[];
}) {
  return (
    <VStack gap={2} width="full" align="stretch">
      <Text fontSize="xs" color="fg.muted" maxWidth="72ch">
        These connections have been removed. They provision nobody and their
        tokens do nothing. Anyone they created is still a member here — taking a
        connection away never takes people away with it.
      </Text>
      {connections.map((connection) => (
        <HStack
          key={connection.connectionId}
          gap={2}
          paddingX={3}
          paddingY={2}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="lg"
          opacity={0.7}
          data-testid="retired-connection"
        >
          <Text fontSize="sm" fontWeight="medium">
            {connection.providerId}
          </Text>
          <IdentityChip
            label={
              connection.connectionState === "DISCARDED"
                ? "Withdrawn before it went live"
                : "Removed"
            }
          />
          <Spacer />
          {connection.managedPeople > 0 && (
            <Text fontSize="xs" color="fg.muted">
              {connection.managedPeople} still here
            </Text>
          )}
        </HStack>
      ))}
    </VStack>
  );
}
type DirectoryChange = Reconciliation["recentChanges"][number];

/**
 * Colour tracks whether the customer has something to do, not how far along
 * the lifecycle is. A connection waiting for its first push is not a problem
 * and must not be dressed as one — that is the whole of the calm-empty-state
 * rule, and a red badge would break it on its own.
 */
const TONE_PALETTE: Record<string, string> = {
  waiting: "gray",
  working: "green",
  attention: "orange",
  ended: "gray",
};

function ConnectionCard({
  connection,
  organizationId,
}: {
  connection: ConnectionPanel;
  /** From the panel's own props: a connection panel carries no tenant, and
   *  the request read is organization-scoped by construction. */
  organizationId: string;
}) {
  return (
    <Card.Root width="full">
      <Card.Body>
        <VStack align="stretch" gap={4}>
          <HStack>
            <VStack align="start" gap={0}>
              <Text fontWeight="600">{connection.providerId}</Text>
              {connection.verifiedDomains.length > 0 && (
                <Text fontSize="xs" color="fg.muted">
                  {connection.verifiedDomains.join(", ")}
                </Text>
              )}
            </VStack>
            <Spacer />
            <Badge
              colorPalette={TONE_PALETTE[connection.status.tone] ?? "gray"}
            >
              {connection.status.headline}
            </Badge>
          </HStack>

          <Text fontSize="sm" color="fg.muted">
            {connection.status.waitingFor}
          </Text>

          <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
            <Fact label="Last push from the directory">
              {connection.lastPushedAtMs
                ? new Date(connection.lastPushedAtMs).toLocaleString()
                : "No push yet"}
            </Fact>
            <Fact label="People this directory manages">
              {connection.managedPeople}
            </Fact>
          </SimpleGrid>

          {connection.failures.length > 0 && (
            <DirectoryFailures connection={connection} />
          )}

          {/* Under the facts and the failures, because it answers a question
              the reader only has once those did not answer it. */}
          <DirectoryRequestsPanel
            organizationId={organizationId}
            connectionId={connection.connectionId}
          />
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * The failures, as words. No reason code and no identifier for the record
 * behind it: both are things a customer would have to bring to us anyway, and
 * showing them invites a person to read an error surface as a debugging tool
 * instead of as an instruction.
 */
function DirectoryFailures({ connection }: { connection: ConnectionPanel }) {
  return (
    <Box>
      <Text fontWeight="600" fontSize="sm" marginBottom={2}>
        Not applied
      </Text>
      <VStack align="stretch" gap={3}>
        {connection.failures.map((failure) => (
          <Box key={`${failure.title}-${failure.occurredAtMs}`}>
            <Text fontSize="sm">{failure.title}</Text>
            <Text fontSize="sm" color="fg.muted">
              {failure.description}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {new Date(failure.occurredAtMs).toLocaleString()}
            </Text>
          </Box>
        ))}
      </VStack>
      {/* Where a retry control would have gone. Saying what puts it right is
          more use than a button that would compete with the directory's own
          next push. */}
      <Text fontSize="sm" color="fg.muted" marginTop={3}>
        {connection.remediation}
      </Text>
    </Box>
  );
}

/**
 * What the directory did, with the directory named as the author. That
 * attribution is the point of the list: a membership change nobody in the
 * organization made needs an author before anybody goes looking for who made
 * it.
 */
function RecentDirectoryChanges({ changes }: { changes: DirectoryChange[] }) {
  return (
    <VStack align="stretch" gap={3}>
      <Heading size="sm">Recent changes from your identity provider</Heading>
      {changes.length === 0 && (
        <Text color="fg.muted" fontSize="sm">
          Your identity provider has not changed anyone&apos;s access yet.
        </Text>
      )}
      <VStack align="stretch" gap={2}>
        {changes.map((change) => (
          <HStack key={change.grantId} gap={3}>
            <Badge colorPalette={change.kind === "removed" ? "red" : "green"}>
              {change.kind === "removed" ? "Removed" : "Added"}
            </Badge>
            <Text fontSize="sm">{change.summary}</Text>
            <Spacer />
            <Text fontSize="xs" color="fg.muted">
              {change.author} · {new Date(change.occurredAtMs).toLocaleString()}
            </Text>
          </HStack>
        ))}
      </VStack>
    </VStack>
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
