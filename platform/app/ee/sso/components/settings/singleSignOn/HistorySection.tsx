import { Box, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import {
  groupHistoryByDay,
  type HistoryDayEntry,
} from "@ee/sso/logic/historyDays";
import { IdentityChip } from "~/components/access/IdentityRow";
import { SettingsCard } from "~/components/settings/kit/SettingsCard";
import { useSSESubscription } from "~/hooks/useSSESubscription";
import { api } from "~/utils/api";
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
 *
 * SHAPED LIKE A LOG RATHER THAN A PARAGRAPH OF ROWS. It was a bare flex list
 * at the page's smallest size, unframed on a page where everything else sits
 * in a card, with the full date repeated on every line and the time given
 * the same weight as the thing that happened. Three changes, no new data: it
 * is framed like its neighbours, the date is stated once per day it covers,
 * and the sentence — the part anybody came here to read — is the largest
 * thing on the row.
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
  // Read at render: the labels are "Today" and "Yesterday", which are facts
  // about when the page is being looked at rather than about the events.
  const days = groupHistoryByDay({ entries: rows, nowMs: Date.now() });

  return (
    /* NAMED THE WAY IT IS LOOKED FOR. It read "What happened to this
       connection", which is what it holds and not what anybody scans for —
       somebody hunting the audit trail searches the page for "log" or
       "history" and slid straight past a sentence. The sentence keeps its
       job as the card's hint, where it says what the list is. */
    <SettingsCard
      title="Event log"
      hint="What happened to this connection, newest first."
      data-testid="connection-history"
    >
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

      <VStack align="stretch" gap={3}>
        {days.map((day) => (
          <Box key={day.key}>
            <Text
              fontSize="11.5px"
              fontWeight="600"
              color="fg.muted"
              paddingBottom={1.5}
            >
              {day.label}
            </Text>
            <VStack align="stretch" gap={0}>
              {day.entries.map((entry, index) => (
                <HistoryRow
                  key={entry.eventId}
                  entry={entry}
                  last={index === day.entries.length - 1}
                />
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>
    </SettingsCard>
  );
}

/**
 * The clock, without the date beside it.
 *
 * The day is the heading above the group now, so a row states only the time
 * it happened at. `tabular-nums` and two-digit fields between them fix both
 * the character count and the character width, which is what makes a column
 * of times line up without a guessed `minWidth` holding it open. The
 * reader's own locale still decides how it is written.
 */
const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

/**
 * One thing that happened, on a rail.
 *
 * The rail is the same language the setup steps above it already speak — a
 * dot per event and a hairline joining them — which is what turns a list of
 * sentences into a sequence. It is decoration over the order the rows are
 * already in, so it is hidden from a reader who is being read to.
 */
function HistoryRow({
  entry,
  last,
}: {
  entry: HistoryDayEntry;
  last: boolean;
}) {
  return (
    <HStack gap={3} align="stretch" data-testid="connection-history-entry">
      <VStack
        gap={0}
        width="7px"
        flexShrink={0}
        paddingTop="7px"
        aria-hidden="true"
      >
        <Box
          width="7px"
          height="7px"
          borderRadius="full"
          background="border.emphasized"
          flexShrink={0}
        />
        {!last && <Box flex={1} width="1px" background="border.muted" />}
      </VStack>
      <HStack
        gap={3}
        align="start"
        paddingBottom={last ? 0 : 2.5}
        minWidth={0}
        flex={1}
      >
        <Text
          fontSize="11.5px"
          color="fg.muted"
          flexShrink={0}
          whiteSpace="nowrap"
          fontVariantNumeric="tabular-nums"
          lineHeight="1.5"
        >
          {new Date(entry.occurredAtMs).toLocaleTimeString(
            undefined,
            TIME_FORMAT,
          )}
        </Text>
        <Text fontSize="13px" lineHeight="1.5" minWidth={0}>
          {entry.summary}
        </Text>
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
    </HStack>
  );
}
