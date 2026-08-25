import {
  Card,
  HStack,
  SimpleGrid,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ReactNode } from "react";
import { api } from "~/utils/api";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";
import { IdentityChip } from "./IdentityRow";

/** Sources named in the band before the rest collapse into a count. */
const SOURCES_SHOWN = 3;

/**
 * The five facts an IT administrator opens the Directory page for.
 *
 * Which sources are connected and what each one is doing, when the last push
 * landed, how many people the directory manages, how many groups it sent, and
 * how many members it does NOT manage. The first four were readable before —
 * spread across a panel of connection cards, a token table and another page
 * entirely — and reading them meant knowing where each one lived. They lead
 * now, because "is this working" is the question, and every tab below is what
 * to do about the answer.
 *
 * THE FIFTH IS THE ONE NOBODY COULD ANSWER. A directory that syncs perfectly
 * still says nothing about the people who are here without it — invited by a
 * colleague, or walked in on the domain policy — and those are exactly the
 * accounts that survive being removed from the identity provider. The count
 * comes from the provenance every member already carries, so nothing new is
 * recorded to say it.
 *
 * Each number is read where it is already written: the reconciliation
 * projection for the first three, the group list for the fourth, member
 * provenance for the fifth.
 *
 * WHAT IS NOT HERE. Departments, several kinds of source at once, and the
 * directory identities that never matched anybody are all things this
 * organization's data does not hold, so the band says nothing about them
 * rather than drawing an empty frame that implies it one day will.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export function DirectorySummary({
  organizationId,
  canReadMembership,
}: {
  organizationId: string;
  /** Groups and provenance are both `organization:manage` reads; a reviewer
   *  holding only `sso:view` gets the other three facts and an honest word
   *  rather than a zero they would read as an answer. */
  canReadMembership: boolean;
}) {
  const reconciliation = api.scimReconciliation.getAll.useQuery({
    organizationId,
  });
  const groups = api.group.listAll.useQuery(
    { organizationId },
    { enabled: canReadMembership && !!organizationId },
  );
  const provenance = api.organization.getMemberProvenance.useQuery(
    { organizationId },
    { enabled: canReadMembership && !!organizationId },
  );

  if (reconciliation.isError) {
    return (
      <SectionErrorNotice
        error={reconciliation.error}
        fallbackTitle="Couldn't read your directory"
      />
    );
  }

  if (reconciliation.isLoading) {
    return <Spinner size="sm" />;
  }

  const connections = reconciliation.data?.connections ?? [];
  const lastPushedAtMs = connections.reduce<number | null>(
    (latest, connection) =>
      connection.lastPushedAtMs !== null &&
      (latest === null || connection.lastPushedAtMs > latest)
        ? connection.lastPushedAtMs
        : latest,
    null,
  );
  const people = connections.reduce(
    (total, connection) => total + connection.managedPeople,
    0,
  );
  const directoryGroups = (groups.data ?? []).filter(
    (group) => group.scimSource !== null,
  ).length;

  const members = Object.values(provenance.data ?? {});
  const outsideDirectory = members.filter(
    (member) => member.source !== "directory",
  ).length;

  return (
    <VStack align="stretch" gap={3} width="full">
      <Card.Root width="full" data-testid="directory-summary">
        <Card.Body>
          <SimpleGrid columns={{ base: 1, sm: 2, lg: 5 }} gap={6}>
            <Fact label="Sources connected">
              <SourceChips connections={connections} />
            </Fact>
            <Fact label="Last sync">
              <Text fontSize="sm">
                {lastPushedAtMs === null
                  ? "No push yet"
                  : new Date(lastPushedAtMs).toLocaleString()}
              </Text>
            </Fact>
            <Fact label="People it manages">
              <Text fontSize="sm">{people}</Text>
            </Fact>
            <Fact label="Groups it sent">
              <Unreadable canRead={canReadMembership} read={groups}>
                <Text fontSize="sm">{directoryGroups}</Text>
              </Unreadable>
            </Fact>
            <Fact label="Members it does not manage">
              <Unreadable canRead={canReadMembership} read={provenance}>
                <Text
                  fontSize="sm"
                  title="People your identity provider did not create. A colleague invited them or a matching domain admitted them, so removing them from your directory will not remove them here."
                  data-testid="members-outside-directory"
                >
                  {outsideDirectory} of {members.length}
                </Text>
              </Unreadable>
            </Fact>
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      {/* Neither of these takes the band down: the three facts that came from
          the sync itself are still on screen and still true. */}
      {groups.isError && (
        <SectionErrorNotice
          error={groups.error}
          fallbackTitle="Couldn't count the groups your directory sent"
        />
      )}
      {provenance.isError && (
        <SectionErrorNotice
          error={provenance.error}
          fallbackTitle="Couldn't work out which members your directory manages"
        />
      )}
    </VStack>
  );
}

/**
 * The connected sources, named.
 *
 * A source is a connection an identity provider pushes through, and naming
 * the provider is what lets an administrator with two of them tell which one
 * is the one that stopped. The status tone rides on the chip rather than
 * standing in a cell of its own, so two sources in two states read as two
 * sources rather than as one confusing summary of both.
 */
function SourceChips({
  connections,
}: {
  connections: Array<{
    connectionId: string;
    providerId: string;
    status: { headline: string; tone: string };
  }>;
}) {
  if (connections.length === 0) {
    return <IdentityChip label="Not set up yet" />;
  }

  const shown = connections.slice(0, SOURCES_SHOWN);
  const rest = connections.length - shown.length;

  return (
    <HStack gap={1} flexWrap="wrap">
      {shown.map((connection) => (
        <IdentityChip
          key={connection.connectionId}
          label={`${connection.providerId} · ${connection.status.headline}`}
          tone={toneOf(connection.status.tone)}
          title={connection.status.headline}
          data-testid="directory-source-chip"
        />
      ))}
      {rest > 0 && (
        <Text fontSize="xs" color="fg.muted">{`+${rest} more`}</Text>
      )}
    </HStack>
  );
}

function toneOf(tone: string): "neutral" | "good" | "warning" | "bad" {
  if (tone === "working") return "good";
  if (tone === "attention") return "warning";
  return "neutral";
}

/**
 * A fact this reader cannot have, said as a word rather than as a number.
 *
 * A zero is an answer, and "you may not read this" is not, so the two must
 * never look the same: an administrator scanning for a directory that sent no
 * groups would otherwise read a permission boundary as a working sync with
 * nothing in it.
 */
function Unreadable({
  canRead,
  read,
  children,
}: {
  canRead: boolean;
  read: { isLoading: boolean; isError: boolean };
  children: ReactNode;
}) {
  const { isLoading, isError } = read;
  if (!canRead) {
    return (
      <Text fontSize="sm" color="fg.muted" title="Not yours to read.">
        Unavailable
      </Text>
    );
  }
  if (isError) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Unavailable
      </Text>
    );
  }
  if (isLoading) return <Spinner size="xs" />;
  return <>{children}</>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack align="start" gap={1}>
      <Text fontSize="xs" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <HStack>{children}</HStack>
    </VStack>
  );
}
