import {
  Card,
  HStack,
  SimpleGrid,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ReactNode } from "react";
import {
  DirectoryFactUnavailable,
  DirectorySourceChips,
} from "~/features/directory/components/DirectoryFacts";
import { useDirectoryFacts } from "~/features/directory/hooks/useDirectoryFacts";
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
    return <Spinner size="sm" />;
  }

  return (
    <VStack align="stretch" gap={3} width="full">
      <Card.Root width="full" data-testid="directory-summary">
        <Card.Body>
          <SimpleGrid columns={{ base: 1, sm: 2, lg: 5 }} gap={6}>
            <Fact label="Sources connected">
              <DirectorySourceChips connections={facts.connections} />
            </Fact>
            <Fact label="Last sync">
              {/* A date the directory has never written is not a date, so it
                  is set in the muted ink the other "nothing yet" states use
                  rather than in the weight a real timestamp earns. */}
              <Text
                fontSize="sm"
                fontWeight={facts.lastPushedAtMs === null ? 400 : 500}
                color={facts.lastPushedAtMs === null ? "fg.muted" : undefined}
                truncate
              >
                {facts.lastPushedAtMs === null
                  ? "No push yet"
                  : new Date(facts.lastPushedAtMs).toLocaleString()}
              </Text>
            </Fact>
            <Fact label="People it manages">
              <Text fontSize="sm" fontWeight={500}>
                {facts.managedPeople}
              </Text>
            </Fact>
            <Fact label="Groups it sent">
              <DirectoryFactUnavailable
                canRead={canReadMembership}
                read={groups}
              >
                <Text fontSize="sm" fontWeight={500}>
                  {facts.directoryGroups.length}
                </Text>
              </DirectoryFactUnavailable>
            </Fact>
            <Fact label="Members it does not manage">
              <DirectoryFactUnavailable
                canRead={canReadMembership}
                read={provenance}
              >
                <Text
                  fontSize="sm"
                  fontWeight={500}
                  title="People your identity provider did not create. A colleague invited them or a matching domain admitted them, so removing them from your directory will not remove them here."
                  data-testid="members-outside-directory"
                >
                  {facts.outsideDirectory} of {facts.members.length}
                </Text>
              </DirectoryFactUnavailable>
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
 * One fact: what it is called, and what it says.
 *
 * The five cells hold three different kinds of thing — chips, a date, bare
 * numbers — and they were free to set their own type, so the band read as
 * five unrelated little widgets that happened to be in a row. The label is
 * fixed here and the value row is given ONE height, so a cell holding a chip
 * and a cell holding a number put their contents on the same line. That is
 * the whole difference between a row of facts and a row of oddments.
 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <VStack align="start" gap={1.5} minWidth={0}>
      <Text
        fontSize="xs"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="0.04em"
        fontWeight={500}
        lineHeight="1.3"
      >
        {label}
      </Text>
      {/* The chip is the tallest thing any cell can hold, so every cell
          reserves its height. Without it the four text cells sat two pixels
          higher than the one with a chip in it. */}
      <HStack minHeight="6" align="center" minWidth={0}>
        {children}
      </HStack>
    </VStack>
  );
}
