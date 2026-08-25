import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";
import { IdentityChip } from "~/components/access/IdentityRow";
import { formatRelativeTime } from "~/components/me/relativeTime";
import { Link } from "~/components/ui/link";
import { DirectoryFactUnavailable } from "~/features/directory/components/DirectoryFacts";
import { useDirectoryFacts } from "~/features/directory/hooks/useDirectoryFacts";
import { directorySyncChipFor } from "~/features/directory/logic/directorySyncChip";
import { SettingsRowsSkeleton } from "../kit/SettingsSkeleton";
import { SectionErrorNotice } from "../SectionErrorNotice";
import { OverviewCard, OverviewDetail } from "./OverviewCard";

/** Groups named before the rest collapse into a count. */
const GROUPS_SHOWN = 4;

/**
 * How accounts arrive, beside how people sign in (D08, ADR-122).
 *
 * The two belong on one page because they are one question asked twice: an
 * identity provider decides who may sign in AND who exists, and an
 * administrator checking the first almost always wants the second.
 *
 * TWO ROWS AND THE GROUPS. This card is read at a glance, next to a card of
 * the same size about the connection that feeds it, and every row it grows
 * costs the pair their calm. So it answers the two questions somebody
 * actually opens Authentication with — how much of my membership does this
 * thing own, and is it still running — and then names what it sent.
 *
 * MEMBERS IT MANAGES IS A FRACTION, NOT A COUNT. "Forty people" sounds like
 * an answer and is not one: what an administrator needs to know before they
 * remove somebody from the identity provider is how many members that act
 * would NOT touch. The people who arrived another way are the hint under the
 * name, whenever there are any.
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
    // The card's shape is known before its contents are, so nothing jumps
    // when the answer arrives.
    return (
      <OverviewCard title="Directory" data-testid="directory-card">
        <SettingsRowsSkeleton rows={2} showLead={false} showTrailing={false} />
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
          <Link href="/settings/directory?tab=provisioning">
            <Button size="sm" variant="solid" colorPalette="orange">
              Issue a token
              <ArrowRight size={14} />
            </Button>
          </Link>
        ) : (
          <Link href="/settings/directory">
            <Button size="sm" variant="outline">
              See who it manages
              <ArrowRight size={14} />
            </Button>
          </Link>
        )
      }
    >
      {/* ROWS OF NOTHING ARE NOT A STATUS. Until a provider has pushed once,
          every fact this card holds is an absence — "0 of 1", "No push yet",
          "No group has arrived yet" — and drawing them as a table makes a
          connection that is merely NEW look like one that is broken. Worse,
          it buries the single thing that would change any of it. */}
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
          <OverviewDetail
            label="Members it manages"
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

          <OverviewDetail label="Last sync">
            <Text fontSize="13px" whiteSpace="nowrap">
              {facts.lastPushedAtMs === null
                ? "No push yet"
                : formatRelativeTime(facts.lastPushedAtMs)}
            </Text>
          </OverviewDetail>

          {/* NAMED, NOT COUNTED, and under an eyebrow rather than in the
              value column of a row: group names are the one thing on this
              card an administrator recognises at a glance, and squeezed
              right-aligned against a label they wrapped one word per line. */}
          <VStack align="start" gap={1.5} paddingTop={1} width="full">
            <Text
              fontSize="10.5px"
              fontWeight="600"
              letterSpacing="0.06em"
              textTransform="uppercase"
              color="fg.subtle"
            >
              Groups it sent
            </Text>
            <DirectoryFactUnavailable canRead={canReadMembership} read={groups}>
              {facts.directoryGroups.length === 0 ? (
                <Text fontSize="12px" color="fg.muted">
                  None yet
                </Text>
              ) : (
                <HStack gap={1} flexWrap="wrap">
                  {shownGroups.map((group) => (
                    <IdentityChip
                      key={group.id}
                      label={group.name}
                      data-testid="directory-card-group-chip"
                    />
                  ))}
                  {restGroups > 0 && (
                    <Text fontSize="11px" color="fg.subtle">
                      {`+${restGroups} more`}
                    </Text>
                  )}
                </HStack>
              )}
            </DirectoryFactUnavailable>
          </VStack>
        </>
      )}
    </OverviewCard>
  );
}
