// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Where each of this organization's directory syncs stands (ADR-122).
 *
 * Read-only, deliberately and permanently: the remedy for a failed apply is
 * the directory's next push, which re-asserts everything it still believes,
 * so a retry control here would be a second thing pushing the same state.
 *
 * Every word on it arrives from the server. The state and the reason codes
 * behind them stay there — a page that reached for a code would be a second
 * place the copy lives.
 */
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
import { type ReactNode, useState } from "react";

import {
  scimApi,
  type ConnectionReconciliationRow,
  type DirectoryChangeRow,
} from "../../behavior/scim-api.ts";
import { isRunningConnection } from "../../model/connection-lifecycle.ts";
import { readableDate } from "../../model/display-formatters.ts";

/**
 * Colour tracks whether the reader has something to do, not how far along the
 * lifecycle is: a connection waiting for its first push is not a problem and
 * must not be dressed as one.
 */
const TONE_PALETTE: Record<string, string> = {
  waiting: "gray",
  working: "green",
  attention: "orange",
  ended: "gray",
};

const RECENT_CHANGES_SHOWN = 8;

export function DirectoryReconciliation({ organizationId }: { organizationId: string }) {
  const reconciliation = scimApi.scimReconciliation.getAll.useQuery({ organizationId });

  if (reconciliation.isLoading) {
    return (
      <VStack align="stretch" gap={0} width="full" data-testid="scim-reconciliation-loading">
        {[0, 1, 2].map((row) => (
          <HStack key={row} justify="space-between" paddingY={2.5}>
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
    <VStack gap={6} width="full" align="stretch" data-testid="scim-reconciliation">
      <VStack gap={3} width="full" align="stretch">
        <Heading size="md">Connections</Heading>
        {connections.length === 0 && <NoConnectionYet />}
        {connections
          .filter((connection) =>
            isRunningConnection({ connectionState: connection.connectionState }),
          )
          .map((connection) => (
            <ConnectionCard key={connection.connectionId} connection={connection} />
          ))}
        <RetiredConnections
          connections={connections.filter(
            (connection) => !isRunningConnection({ connectionState: connection.connectionState }),
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
 * The step is under Authentication, where a connection is registered. It is
 * named rather than offered as a control: this screen has no way to take a
 * reader there until its host publishes one (handoff §10.1).
 */
function NoConnectionYet() {
  return (
    <Text fontSize="sm" color="fg.muted" maxWidth="72ch" data-testid="directory-no-connection">
      No identity provider is connected yet. Provisioning runs against a single sign-on connection,
      so connecting one under Authentication is the first step. After that your identity provider
      creates, updates and removes people here on its own.
    </Text>
  );
}

/**
 * The connections that are history, said as history: kept, not hidden, but
 * folded. The accounts a withdrawn connection provisioned are still members
 * here, so a reader who removes one and then asks where forty people came
 * from needs to find it — and everybody else needs it out of the way.
 */
function RetiredConnections({ connections }: { connections: ConnectionReconciliationRow[] }) {
  const [open, setOpen] = useState(false);

  if (connections.length === 0) return null;

  return (
    <VStack align="stretch" gap={2}>
      <Button
        size="xs"
        variant="ghost"
        alignSelf="start"
        onClick={() => setOpen((shown) => !shown)}
        data-testid="retired-connections-toggle"
      >
        {`No longer connected (${connections.length})`}
      </Button>
      {open && (
        <VStack gap={2} width="full" align="stretch">
          <Text fontSize="xs" color="fg.muted" maxWidth="72ch">
            These connections have been removed. They provision nobody and their tokens do nothing.
            Anyone they created is still a member here — taking a connection away never takes people
            away with it.
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
              <Badge size="sm" colorPalette="gray">
                {connection.connectionState === "DISCARDED"
                  ? "Withdrawn before it went live"
                  : "Removed"}
              </Badge>
              <Spacer />
              {connection.managedPeople > 0 && (
                <Text fontSize="xs" color="fg.muted">
                  {connection.managedPeople} still here
                </Text>
              )}
            </HStack>
          ))}
        </VStack>
      )}
    </VStack>
  );
}

function ConnectionCard({ connection }: { connection: ConnectionReconciliationRow }) {
  return (
    <Card.Root width="full" data-testid="directory-connection">
      <Card.Body>
        <VStack align="stretch" gap={4}>
          <HStack>
            <Text fontWeight="600">{connection.providerId}</Text>
            <Spacer />
            <Badge colorPalette={TONE_PALETTE[connection.status.tone] ?? "gray"}>
              {connection.status.headline}
            </Badge>
          </HStack>

          <Text fontSize="sm" color="fg.muted">
            {connection.status.waitingFor}
          </Text>

          <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
            <Fact label="Last push from the directory">
              {connection.lastPushedAtMs
                ? readableDate(connection.lastPushedAtMs).toLocaleString()
                : "No push yet"}
            </Fact>
            <Fact label="People this directory manages">{connection.managedPeople}</Fact>
          </SimpleGrid>

          {connection.failures.length > 0 && <DirectoryFailures connection={connection} />}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * The failures, as words. No reason code and no identifier for the record
 * behind it: both are things a customer would have to bring to us anyway, and
 * showing them invites reading an error surface as a debugging tool instead
 * of as an instruction.
 */
function DirectoryFailures({ connection }: { connection: ConnectionReconciliationRow }) {
  return (
    <Box data-testid="directory-failures">
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
              {readableDate(failure.occurredAtMs).toLocaleString()}
            </Text>
          </Box>
        ))}
      </VStack>
      {/* Where a retry control would have gone. Saying what puts it right is
          more use than a button competing with the directory's next push. */}
      <Text fontSize="sm" color="fg.muted" marginTop={3}>
        {connection.remediation}
      </Text>
    </Box>
  );
}

function RecentDirectoryChanges({ changes }: { changes: DirectoryChangeRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? changes : changes.slice(0, RECENT_CHANGES_SHOWN);
  const hidden = changes.length - shown.length;

  if (changes.length === 0) return null;

  return (
    <VStack align="stretch" gap={3} data-testid="directory-recent-changes">
      <Heading size="sm">Access changes assigned by your identity provider</Heading>
      <VStack align="stretch" gap={2}>
        {shown.map((change) => (
          <HStack key={change.grantId} gap={3}>
            <Badge colorPalette={change.kind === "removed" ? "red" : "green"}>
              {change.kind === "removed" ? "Removed" : "Added"}
            </Badge>
            <Text fontSize="sm">{change.summary}</Text>
            <Spacer />
            <Text fontSize="xs" color="fg.muted" flexShrink={0}>
              {readableDate(change.occurredAtMs).toLocaleString()}
            </Text>
          </HStack>
        ))}
      </VStack>
      {hidden > 0 && (
        <Button
          alignSelf="start"
          size="xs"
          variant="ghost"
          onClick={() => setShowAll(true)}
          data-testid="recent-changes-show-all"
        >
          Show {hidden} more
        </Button>
      )}
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
