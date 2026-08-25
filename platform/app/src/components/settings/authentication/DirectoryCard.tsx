import { Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
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
    return (
      <OverviewCard title="Directory" data-testid="directory-card">
        <Spinner size="sm" />
      </OverviewCard>
    );
  }

  const shownGroups = facts.directoryGroups.slice(0, GROUPS_SHOWN);
  const restGroups = facts.directoryGroups.length - shownGroups.length;

  return (
    <OverviewCard
      title="Directory"
      chip={directorySyncChipFor(facts.connections)}
      data-testid="directory-card"
      actions={
        <Link href="/settings/directory">
          <Button size="sm" variant="outline">
            See provisioned members
            <ArrowRight size={14} />
          </Button>
        </Link>
      }
    >
      <OverviewDetail label="Sources">
        <DirectorySourceChips connections={facts.connections} />
      </OverviewDetail>

      <OverviewDetail label="Members it manages">
        <DirectoryFactUnavailable canRead={canReadMembership} read={provenance}>
          <VStack align="start" gap={0}>
            <Text fontSize="sm" data-testid="directory-card-members">
              {facts.insideDirectory} of {facts.members.length}
            </Text>
            {facts.outsideDirectory > 0 && (
              <Text fontSize="xs" color="fg.muted">
                {facts.outsideDirectory} arrived another way, so removing them
                from your identity provider will not remove them here.
              </Text>
            )}
          </VStack>
        </DirectoryFactUnavailable>
      </OverviewDetail>

      <OverviewDetail label="Last sync">
        <Text fontSize="sm">
          {facts.lastPushedAtMs === null
            ? "No push yet"
            : new Date(facts.lastPushedAtMs).toLocaleString()}
        </Text>
      </OverviewDetail>

      <OverviewDetail label="Groups it sent">
        <DirectoryFactUnavailable canRead={canReadMembership} read={groups}>
          {facts.directoryGroups.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              No group has arrived yet.
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
                <Text
                  fontSize="xs"
                  color="fg.muted"
                >{`+${restGroups} more`}</Text>
              )}
            </HStack>
          )}
        </DirectoryFactUnavailable>
      </OverviewDetail>
    </OverviewCard>
  );
}
