import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  SimpleGrid,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plug } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../../utils/api";
import RouterLink from "../../utils/compat/next-link";
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
    return (
      <Text color="fg.muted" fontSize="sm">
        Reading what your identity provider has done…
      </Text>
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
        {connections.map((connection) => (
          <ConnectionCard
            key={connection.connectionId}
            connection={connection}
          />
        ))}
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

type Reconciliation = NonNullable<
  ReturnType<typeof api.scimReconciliation.getAll.useQuery>["data"]
>;
type ConnectionPanel = Reconciliation["connections"][number];
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

function ConnectionCard({ connection }: { connection: ConnectionPanel }) {
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
