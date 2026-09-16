import { HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { useSSESubscription } from "~/hooks/useSSESubscription";
import { api } from "../../../utils/api";
import { IdentityChip } from "../../access/IdentityRow";
import { LoadFailure } from "./refusals";

/**
 * What has happened to this connection, read straight off its event history
 * (ADR-117 SS5, D04) — registered, a domain claimed and proved, activated,
 * suspended, and so on, newest first.
 *
 * A READ, permanently. There is no control here and never will be: this
 * panel is the connection's own history, and a history a viewer could edit
 * would not be one. Every word comes from the server
 * (`sso-connection-history-copy.ts`), so a reader never sees an internal
 * event name, and an attested domain is always named as the operator's act
 * rather than the customer's own proof.
 *
 * Offered only to whoever may MANAGE single sign-on, not merely see it — see
 * `ssoSetup.getHistory`'s own docblock for why this one read is held to a
 * narrower permission than the rest of the page.
 *
 * LIVE, WHILE THIS COMPONENT IS ON SCREEN AND NOWHERE ELSE
 * (specs/identity/sso-connection-history.feature, "Live updates"). The
 * subscription below opens only because this component mounted and closes
 * the moment it unmounts — there is no global listener, no app-wide
 * provider and no second place in the product that opens this channel.
 */
export function HistorySection({
  organizationId,
  connectionId,
}: {
  organizationId: string;
  connectionId: string;
}) {
  const history = api.ssoSetup.getHistory.useQuery({
    organizationId,
    connectionId,
  });
  const trpcUtils = api.useUtils();

  // A bare "something changed" signal — never rendered, only acted on. The
  // refetch it triggers is still gated by `getHistory`'s own permission, so
  // a signal carries no disclosure of its own to leak.
  useSSESubscription<
    { connectionId: string },
    { organizationId: string; connectionId: string }
  >(
    // @ts-expect-error - tRPC subscription type isn't perfectly inferred for
    // the hook's generic; the underlying procedure shape matches (see
    // useTraceFreshness's identical use of onDiscoverUpdate).
    api.ssoSetup.onHistoryActivity,
    { organizationId, connectionId },
    {
      onData: () => {
        void trpcUtils.ssoSetup.getHistory.invalidate({
          organizationId,
          connectionId,
        });
      },
    },
  );

  const rows = history.data ?? [];

  return (
    <VStack align="stretch" gap={2} data-testid="connection-history">
      <Text fontWeight="600" fontSize="sm">
        What happened to this connection
      </Text>

      {history.isLoading && <Skeleton height="16px" width="60%" />}

      {/* A read that failed is not a connection with no history — the two
          are different facts, and showing the empty state on a failed read
          tells the reader nothing ever happened when we simply could not
          find out. */}
      {history.isError && (
        <LoadFailure error={history.error} what="this connection's history" />
      )}

      {!history.isLoading && !history.isError && rows.length === 0 && (
        <Text fontSize="xs" color="fg.muted">
          Nothing has happened to this connection yet.
        </Text>
      )}

      {rows.map((entry) => (
        <HistoryRow key={entry.eventId} entry={entry} />
      ))}
    </VStack>
  );
}

interface HistoryEntryRow {
  eventId: string;
  occurredAtMs: number;
  summary: string;
  carriedOver: boolean;
}

/**
 * One column of time, the same width on every row.
 *
 * `toLocaleString()` gave a different LENGTH per row — a one-digit day or
 * hour is a character shorter — so the sentences beside it started in
 * slightly different places and the list read as ragged. Two-digit fields fix
 * the character count and `tabular-nums` fixes the character width, which
 * between them make the column align without a guessed `minWidth` holding it
 * open. The reader's own locale still decides the ORDER of the fields.
 */
const STAMP_FORMAT: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

function HistoryRow({ entry }: { entry: HistoryEntryRow }) {
  return (
    <HStack gap={3} align="start" fontSize="xs">
      <Text
        color="fg.muted"
        flexShrink={0}
        whiteSpace="nowrap"
        fontVariantNumeric="tabular-nums"
      >
        {new Date(entry.occurredAtMs).toLocaleString(undefined, STAMP_FORMAT)}
      </Text>
      <Text>{entry.summary}</Text>
      {/* Named rather than hidden: the weaker evidence an earlier
          configuration carried must never become invisible (D05
          amendment) — a fact the migration produced says so beside it. */}
      {entry.carriedOver && (
        <IdentityChip
          label="Carried over"
          title="From your earlier configuration"
        />
      )}
    </HStack>
  );
}
