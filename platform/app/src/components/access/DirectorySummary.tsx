import {
  Card,
  HStack,
  SimpleGrid,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ReactNode } from "react";
import {
  DirectoryFactUnavailable,
  DirectorySourceChips,
} from "~/features/directory/components/DirectoryFacts";
import { useDirectoryFacts } from "~/features/directory/hooks/useDirectoryFacts";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";

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
 * The numbers themselves are `useDirectoryFacts`, shared with the
 * Authentication overview's directory card, so the two screens cannot report
 * different syncs.
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
  const facts = useDirectoryFacts({ organizationId, canReadMembership });
  const { reconciliation, groups, provenance } = facts;

  if (reconciliation.isError) {
    return (
      <SectionErrorNotice
        error={reconciliation.error}
        fallbackTitle="Couldn't read your directory"
      />
    );
  }

  if (reconciliation.isLoading) {
    // The shape is known before the data is, so the wait shows the five
    // tiles rather than a spinner the content then displaces.
    return (
      <SimpleGrid columns={{ base: 1, sm: 2, lg: 5 }} gap={3} width="full">
        {[0, 1, 2, 3, 4].map((tile) => (
          <VStack
            key={tile}
            align="start"
            gap={2}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="lg"
            padding={3}
          >
            <Skeleton height="2.5" width="16" />
            <Skeleton height="4" width="24" />
          </VStack>
        ))}
      </SimpleGrid>
    );
  }

  return (
    <VStack align="stretch" gap={3} width="full">
      <SimpleGrid
        columns={{ base: 1, sm: 2, lg: 5 }}
        gap={3}
        data-testid="directory-summary"
      >
        <Fact
          label="Authentication source"
          hint="Configured on the Authentication page."
        >
          {/* The names ARE the value here: an administrator with two sources
              is not asking how many they have, they are asking which one is
              the one that stopped. The hint says where sources are
              configured, and `addHref` makes that sentence pressable. */}
          <DirectorySourceChips
            connections={facts.connections}
            addHref="/settings/authentication"
          />
        </Fact>
        <Fact label="Last sync">
          {/* A date the directory has never written is not a date, so it
              is set in the muted ink the other "nothing yet" states use
              rather than in the weight a real timestamp earns. */}
          <Text
            fontSize="lg"
            lineHeight="1.3"
            fontWeight={facts.lastPushedAtMs === null ? 400 : 600}
            letterSpacing="-0.01em"
            color={facts.lastPushedAtMs === null ? "fg.muted" : undefined}
            title={
              facts.lastPushedAtMs === null
                ? undefined
                : new Date(facts.lastPushedAtMs).toLocaleString()
            }
            truncate
            maxWidth="full"
          >
            {facts.lastPushedAtMs === null
              ? "No push yet"
              : formatTimeAgo(facts.lastPushedAtMs)}
          </Text>
        </Fact>
        <Fact label="People it manages">
          <FactNumber>{facts.managedPeople}</FactNumber>
        </Fact>
        <Fact label="Groups it sent">
          <DirectoryFactUnavailable canRead={canReadMembership} read={groups}>
            <FactNumber>{facts.directoryGroups.length}</FactNumber>
          </DirectoryFactUnavailable>
        </Fact>
        <Fact
          label="Members it does not manage"
          hint="Invited by a colleague or admitted by a domain, so removing them from your directory will not remove them here."
        >
          <DirectoryFactUnavailable
            canRead={canReadMembership}
            read={provenance}
          >
            <FactNumber data-testid="members-outside-directory">
              {facts.outsideDirectory} of {facts.members.length}
            </FactNumber>
          </DirectoryFactUnavailable>
        </Fact>
      </SimpleGrid>

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
 * One fact as its own quiet tile: what it is called on top, what it says
 * underneath, and at most one small line after that.
 *
 * A tile each rather than five cells in one card, because the facts are
 * glanced at independently — "is it syncing" and "how many people" are
 * different questions on different visits — and a shared card made every
 * glance read the other four. The label is fixed here and the value row is
 * given ONE height, so a tile holding chips and a tile holding a number put
 * their contents on the same line.
 */
function Fact({
  label,
  hint,
  children,
}: {
  label: string;
  /** One small line under the value; on hover it says the whole of it. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Card.Root borderRadius="xl" minWidth={0}>
      <Card.Body paddingX={4} paddingY={3}>
        <VStack align="start" gap={1.5} minWidth={0}>
          <Text
            fontSize="xs"
            color="fg.muted"
            fontWeight={500}
            lineHeight="1.3"
          >
            {label}
          </Text>
          {/* The chip is the tallest thing any tile can hold, so every tile
              reserves its height. Without it the text tiles sat two pixels
              higher than the one with a chip in it. */}
          <HStack minHeight="7" align="center" minWidth={0} maxWidth="full">
            {children}
          </HStack>
          {hint && (
            <Text
              fontSize="11px"
              color="fg.muted"
              lineHeight="1.35"
              title={hint}
              lineClamp={2}
            >
              {hint}
            </Text>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/** A fact that is a number: the tile's big, tabular figure. */
function FactNumber({
  children,
  "data-testid": testId,
}: {
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <Text
      fontSize="lg"
      lineHeight="1.3"
      fontWeight={600}
      letterSpacing="-0.01em"
      fontVariantNumeric="tabular-nums"
      truncate
      maxWidth="full"
      data-testid={testId}
    >
      {children}
    </Text>
  );
}
