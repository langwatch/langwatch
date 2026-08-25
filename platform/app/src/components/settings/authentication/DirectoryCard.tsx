import { Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import { IdentityChip } from "~/components/access/IdentityRow";
import { Link } from "~/components/ui/link";
import {
  DirectoryFactUnavailable,
  DirectorySourceChips,
} from "~/features/directory/components/DirectoryFacts";
import { useDirectoryFacts } from "~/features/directory/hooks/useDirectoryFacts";
import { directorySyncChipFor } from "~/features/directory/logic/directorySyncChip";
import { SectionErrorNotice } from "../SectionErrorNotice";
import { OverviewCard, OverviewDetail } from "./OverviewCard";

/** Groups named before the rest collapse into a count. */
const GROUPS_SHOWN = 3;

/**
 * How accounts arrive, beside how people sign in (D08, ADR-122).
 *
 * The two belong on one page because they are one question asked twice: an
 * identity provider decides who may sign in AND who exists, and an
 * administrator checking the first almost always wants the second. The
 * numbers are the Directory page's own — read through `useDirectoryFacts`, so
 * the two screens cannot report different syncs — drawn small enough to sit
 * beside the connection rather than compete with it.
 *
 * MEMBERS IT MANAGES IS A FRACTION, NOT A COUNT. "Forty people" sounds like
 * an answer and is not one: what an administrator needs to know before they
 * remove somebody from the identity provider is how many members that act
 * would NOT touch. The people who arrived another way are named right under
 * the fraction, whenever there are any.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
export function DirectoryCard({
  organizationId,
  canReadMembership,
}: {
  organizationId: string;
  /** Groups and provenance are `organization:manage` reads. */
  canReadMembership: boolean;
}) {
  const facts = useDirectoryFacts({ organizationId, canReadMembership });
  const { reconciliation, groups, provenance } = facts;

  if (reconciliation.isError) {
    return (
      <OverviewCard title="Directory" data-testid="directory-card">
        <SectionErrorNotice
          error={reconciliation.error}
          fallbackTitle="Couldn't read your directory"
        />
      </OverviewCard>
    );
  }

  if (reconciliation.isLoading) {
    // The card's two detail rows, as placeholders: the shape is known
    // before the data is, so nothing jumps when it arrives.
    return (
      <OverviewCard title="Directory" data-testid="directory-card">
        <VStack align="stretch" gap={3}>
          <Skeleton height="4" width="40%" />
          <Skeleton height="4" width="60%" />
        </VStack>
      </OverviewCard>
    );
  }

  const shownGroups = facts.directoryGroups.slice(0, GROUPS_SHOWN);
  const restGroups = facts.directoryGroups.length - shownGroups.length;
  /** No provider has ever pushed, so every fact here would be an absence. */
  const nothingHasArrived = facts.lastPushedAtMs === null;

  return (
    <OverviewCard
      title="Directory"
      chip={directorySyncChipFor(facts.connections)}
      data-testid="directory-card"
      // THE ACTION IS WHATEVER WOULD MOVE THIS ON. Before a first push that
      // is issuing a token; after one it is going to see who arrived.
      // Offering "see provisioned members" to somebody with no provisioned
      // members is an invitation to an empty table.
      actions={
        nothingHasArrived ? (
          <Link href="/settings/directory?tab=tokens">
            <Button size="sm" variant="solid" colorPalette="orange">
              Issue a token
              <ArrowRight size={14} />
            </Button>
          </Link>
        ) : (
          <Link href="/settings/directory">
            <Button size="sm" variant="outline">
              See provisioned members
              <ArrowRight size={14} />
            </Button>
          </Link>
        )
      }
    >
      {/* THE ROWS ARE QUESTIONS, the same way the sign-on card beside this
          one asks them. "Sources" left a reader guessing what kind of source
          on a page whose other half is the connection these ARE; asking where
          people come from names the thing and makes the trip back obvious in
          one line. */}
      <OverviewDetail label="Where do people come from?">
        <DirectorySourceChips connections={facts.connections} />
      </OverviewDetail>

      {/* FOUR ROWS OF NOTHING IS NOT A STATUS. Until a provider has pushed
          once, every fact this card holds is an absence — "0 of 1", "No push
          yet", "No group has arrived yet" — and drawing them as a table makes
          a connection that is merely NEW look like one that is broken. Worse,
          it buries the single thing that would change any of it.
          So before the first push the card says what is missing and what
          fixes it, in one sentence, and the token becomes the action. The
          facts come back the moment there are any. */}
      {nothingHasArrived ? (
        <VStack align="start" gap={1} paddingY={1}>
          <Text fontSize="13px" fontWeight="500">
            Nothing has arrived yet
          </Text>
          <Text
            fontSize="11.5px"
            lineHeight="1.6"
            color="fg.muted"
            maxWidth="46ch"
          >
            Your identity provider creates and removes people here using a
            provisioning token — no one has to sign in for it to work. Issue a
            token, paste it into your provider, and the members, groups and sync
            time fill themselves in.
          </Text>
        </VStack>
      ) : (
        <>
          {/* A FRACTION, and the caveat under its own name rather than beside
              the number: a whole sentence in the value column squeezed the
              name into one word per line and then overlapped it. */}
          <OverviewDetail
            label="How many members does it manage?"
            hint={
              facts.outsideDirectory > 0
                ? `${facts.outsideDirectory} arrived another way, so removing them from your identity provider will not remove them here.`
                : undefined
            }
          >
            <DirectoryFactUnavailable
              canRead={canReadMembership}
              read={provenance}
            >
              <Text
                fontSize="13px"
                fontVariantNumeric="tabular-nums"
                whiteSpace="nowrap"
                data-testid="directory-card-members"
              >
                {facts.insideDirectory} of {facts.members.length}
              </Text>
            </DirectoryFactUnavailable>
          </OverviewDetail>

          <OverviewDetail label="When did it last push?">
            <Text fontSize="13px" whiteSpace="nowrap">
              {facts.lastPushedAtMs === null
                ? "It never has"
                : new Date(facts.lastPushedAtMs).toLocaleString()}
            </Text>
          </OverviewDetail>

          <OverviewDetail label="Which groups has it sent?">
            <DirectoryFactUnavailable canRead={canReadMembership} read={groups}>
              {facts.directoryGroups.length === 0 ? (
                <Text fontSize="13px" color="fg.muted">
                  None yet
                </Text>
              ) : (
                <HStack gap={1} flexWrap="wrap" justify="end">
                  {shownGroups.map((group) => (
                    <IdentityChip
                      key={group.id}
                      label={group.name}
                      data-testid="directory-card-group-chip"
                    />
                  ))}
                  {restGroups > 0 && (
                    <Text
                      fontSize="xs"
                      color="fg.muted"
                    >{`+${restGroups} more`}</Text>
                  )}
                </HStack>
              )}
            </DirectoryFactUnavailable>
          </OverviewDetail>
        </>
      )}
    </OverviewCard>
  );
}
