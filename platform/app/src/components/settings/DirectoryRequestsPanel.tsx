import { Badge, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { HandledErrorAlert } from "~/features/errors";
import { api } from "../../utils/api";

/**
 * What the identity provider actually asked us, and what we said back
 * (ADR-126).
 *
 * THE QUESTION THIS ANSWERS is "my provider says it is syncing and your page
 * says no push yet". The card above reads the sync log, which only carries
 * what the directory DECIDED — a push refused before it reached a handler
 * decided nothing, appends no fact, and is invisible there. That refusal is
 * the whole of what somebody who has just pasted a token needs to see, so it
 * is here.
 *
 * NO CONTROL, NOT EVEN A DISCLOSURE. The panel this sits in offers nothing
 * that acts — the remediation for a failed apply is the directory's next
 * push, and a page whose only button is one that cannot help is worse than a
 * page with none. A collapse toggle is still a control, and the invariant is
 * enforced by a test that counts buttons, so the list is simply here, bounded
 * by the read that produced it.
 *
 * AN ABSENT ROW IS NOT A DENIAL. Requests age out of a retention window, so
 * the empty state says what this holds rather than that nothing was ever
 * sent — the two are different, and only one of them is ours to assert.
 */
export function DirectoryRequestsPanel({
  organizationId,
  connectionId,
}: {
  organizationId: string;
  connectionId: string;
}) {
  const requests = api.scimReconciliation.getRequests.useQuery({
    organizationId,
    connectionId,
  });

  const rows = requests.data ?? [];

  return (
    <VStack align="stretch" gap={2} data-testid="directory-requests">
      <Text fontWeight="600" fontSize="sm">
        Requests from your identity provider
      </Text>
      {requests.isLoading && <Skeleton height="16px" width="60%" />}

      {/* A feed we could not read is not a feed with nothing in it. This
          component's own promise is that an absent row is not a denial, and
          rendering the empty state on a failed read makes exactly that denial
          to the one reader trying to establish whether their provider reached
          us at all. */}
      {requests.isError && (
        <HandledErrorAlert
          error={requests.error}
          fallbackTitle="We couldn't read what your identity provider has sent"
          onRetry={() => void requests.refetch()}
        />
      )}

      {!requests.isLoading && !requests.isError && rows.length === 0 && (
        <Text fontSize="xs" color="fg.muted" maxWidth="72ch">
          No requests recorded. We keep them for thirty days, so this is what we
          still hold rather than everything your identity provider has ever
          sent.
        </Text>
      )}

      {rows.map((request) => (
        <RequestRow key={request.id} request={request} />
      ))}

      {rows.length > 0 && (
        <Text fontSize="xs" color="fg.muted" maxWidth="72ch">
          {/* The one failure this surface structurally cannot show, said
              plainly rather than left for the reader to infer from a feed
              that is empty for other reasons too. */}
          A request that arrives with a token we do not recognise is refused
          before we know whose it is, so it can never appear here. If your
          provider reports errors and nothing is listed, check that the token it
          presents is the one issued below.
        </Text>
      )}
    </VStack>
  );
}

type RequestEntry = {
  id: string;
  method: string;
  resource: string;
  status: number;
  reason: string | null;
  detail: string | null;
  occurredAt: Date | string;
};

/**
 * The resource a request named, said the way an administrator reads it.
 *
 * The stored form keeps `:id` so that "the same thing, forty times" groups
 * into forty rows of one shape. That is a routing convention, though, and a
 * person reading their directory's activity has no reason to know it.
 */
function resourceInWords(resource: string): string {
  const spoken: Record<string, string> = {
    Users: "users",
    "Users/:id": "one user",
    Groups: "groups",
    "Groups/:id": "one group",
    ServiceProviderConfig: "our configuration",
    Schemas: "our schemas",
    ResourceTypes: "our resource types",
  };
  return spoken[resource] ?? resource;
}

/**
 * What kind of refusal it was, when we have no sentence of our own.
 *
 * Every slug here is one WE chose, so putting it into words costs nothing and
 * an unmapped one falls through to the slug rather than to silence.
 */
function reasonInWords(reason: string | null): string | null {
  if (!reason) return null;
  const spoken: Record<string, string> = {
    plan_not_entitled: "Your plan no longer includes directory sync",
    unauthorized: "The token presented was not one we recognise",
    malformed_body: "The request body could not be read as JSON",
    invalid_resource: "The resource sent was not one we can accept",
    not_found: "The person or group named does not exist here",
    conflict: "That would collide with something already here",
    rate_limited: "Too many requests arrived at once",
    unsupported: "Your provider asked for something we do not offer",
    internal_error: "Something on our side went wrong",
  };
  return spoken[reason] ?? reason;
}

function RequestRow({ request }: { request: RequestEntry }) {
  const refused = request.status >= 400;
  return (
    <HStack gap={3} align="start" fontSize="xs">
      <Text color="fg.muted" minWidth="14ch">
        {new Date(request.occurredAt).toLocaleString()}
      </Text>
      <Text minWidth="18ch">
        {request.method} {resourceInWords(request.resource)}
      </Text>
      <Badge colorPalette={refused ? "orange" : "green"} size="sm">
        {refused ? "Refused" : "Accepted"}
      </Badge>
      {/* OUR sentence, which the server already wrote — never the identity
          provider's own message and never a validator's. When there is none,
          the reason still says which KIND of refusal it was, which is the
          difference between a row a reader can act on and an orange badge. */}
      {(request.detail ?? (refused ? reasonInWords(request.reason) : null)) && (
        <Text color="fg.muted" maxWidth="52ch">
          {request.detail ?? reasonInWords(request.reason)}
        </Text>
      )}
    </HStack>
  );
}
