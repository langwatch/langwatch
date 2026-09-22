// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the identity provider asked us, and what we answered (ADR-126).
 *
 * The question this answers is "my provider says it is syncing and your page
 * says nothing arrived". A push refused before it reached a handler decided
 * nothing and appears nowhere else, and that refusal is the whole of what
 * somebody who has just pasted a token needs to read.
 */
import { Alert, Badge, Heading, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";

import { scimApi, type ScimRequestRow } from "../../behavior/scim-api.ts";
import { connectionLabel, readableDate } from "../../model/display-formatters.ts";
import { isRefusal, reasonInWords, resourceInWords } from "../../model/request-log-words.ts";

/** A connection as the settings page already holds it. */
export type DirectoryRequestsConnection = {
  connectionId: string;
  displayName: string;
  type: string;
};

/**
 * No control, not even a disclosure: the remedy for a refused push is the
 * directory's next one, and a surface whose only button cannot help is worse
 * than one with none.
 */
export function DirectoryRequests({
  organizationId,
  connections,
}: {
  organizationId: string;
  connections: DirectoryRequestsConnection[];
}) {
  if (connections.length === 0) return null;

  return (
    <VStack gap={4} width="full" align="stretch">
      <Heading size="md">Requests from your identity provider</Heading>
      {connections.map((connection) => (
        <ConnectionRequests
          key={connection.connectionId}
          organizationId={organizationId}
          connection={connection}
        />
      ))}
    </VStack>
  );
}

function ConnectionRequests({
  organizationId,
  connection,
}: {
  organizationId: string;
  connection: DirectoryRequestsConnection;
}) {
  // The organization travels with the connection: a connection id is not a
  // tenant, and this page has one.
  const requests = scimApi.scimReconciliation.getRequests.useQuery({
    organizationId,
    connectionId: connection.connectionId,
  });

  const rows = requests.data ?? [];

  return (
    <VStack align="stretch" gap={2} data-testid="directory-requests">
      <Text fontWeight="600" fontSize="sm">
        {connectionLabel({
          displayName: connection.displayName,
          connectionType: connection.type,
        })}
      </Text>

      {requests.isLoading && <Skeleton height="16px" width="60%" />}

      {/* A feed we could not read is not a feed with nothing in it, and the
          empty state below would deny a push to the one reader trying to
          establish whether their provider reached us at all. */}
      {requests.isError && (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>We could not read what your identity provider has sent</Alert.Title>
          </Alert.Content>
        </Alert.Root>
      )}

      {!requests.isLoading && !requests.isError && rows.length === 0 && (
        <Text fontSize="xs" color="fg.muted" maxWidth="72ch">
          No requests recorded. We keep them for thirty days, so this is what we still hold rather
          than everything your identity provider has ever sent.
        </Text>
      )}

      {rows.map((request) => (
        <RequestRow key={request.id} request={request} />
      ))}

      {rows.length > 0 && (
        // The one failure this surface structurally cannot show, said plainly
        // rather than left to be inferred from a feed that is empty for other
        // reasons too.
        <Text fontSize="xs" color="fg.muted" maxWidth="72ch">
          A request that arrives with a token we do not recognize is refused before we know whose it
          is, so it can never appear here. If your provider reports errors and nothing is listed,
          check that the token it presents is one issued above.
        </Text>
      )}
    </VStack>
  );
}

function RequestRow({ request }: { request: ScimRequestRow }) {
  const refused = isRefusal(request.status);
  // Our own sentence, which the server already wrote — never the identity
  // provider's message and never a validator's. Without one, the reason still
  // says which KIND of refusal it was.
  const said = request.detail ?? (refused ? reasonInWords(request.reason) : null);

  return (
    <HStack gap={3} align="start" fontSize="xs">
      <Text color="fg.muted" minWidth="14ch">
        {readableDate(request.occurredAt).toLocaleString()}
      </Text>
      <Text minWidth="18ch">
        {request.method} {resourceInWords(request.resource)}
      </Text>
      <Badge colorPalette={refused ? "orange" : "green"} size="sm">
        {refused ? "Refused" : "Accepted"}
      </Badge>
      {said && (
        <Text color="fg.muted" maxWidth="52ch">
          {said}
        </Text>
      )}
    </HStack>
  );
}
