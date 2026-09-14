import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowRight, Settings2 } from "lucide-react";
import { IdentityChip } from "~/components/access/IdentityRow";
import { formatRelativeTime } from "~/components/me/relativeTime";
import { Link } from "~/components/ui/link";
import { DirectoryFactUnavailable } from "~/features/directory/components/DirectoryFacts";
import { useDirectoryFacts } from "~/features/directory/hooks/useDirectoryFacts";
import { directorySyncChipFor } from "~/features/directory/logic/directorySyncChip";
import { isEnterpriseGateError } from "~/features/directory/logic/enterpriseGate";
import { SettingsRowsSkeleton } from "../kit/SettingsSkeleton";
import { SectionErrorNotice } from "../SectionErrorNotice";
import { useDepartmentColumn } from "../useDepartmentColumn";
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
 * thing own, and is it still running — and then names what it sent. Where
 * the organization has departments, they are named under the groups in the
 * same shape; where it has none, nothing takes their place.
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

  // The org structure the directory's people sit in. This card is also read
  // by holders of `sso:view` WITHOUT `governance:view`; the hook degrades to
  // "nothing to show" for them rather than refusing, so no permission gate
  // here — and no layout shift, because the block simply never renders.
  const department = useDepartmentColumn(organizationId);

  if (reconciliation.isError) {
    // A plan gate is not a failure: on a non-Enterprise organization this is
    // the card's DEFAULT state, so it says so quietly — an error notice with
    // a trace id would report an upsell as something broken.
    if (isEnterpriseGateError(reconciliation.error)) {
      return (
        <OverviewCard title="Directory" data-testid="directory-card">
          <Text fontSize="13px" color="fg.muted">
            Syncing your directory is part of the Enterprise plan. Contact sales
            to upgrade.
          </Text>
        </OverviewCard>
      );
    }
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
  /**
   * "Nothing has arrived" is not one state, and the card knows which one it
   * is looking at: no connection at all (the next move is a token), a
   * connection whose token is issued but whose provider has not pushed yet
   * (the next move is the provider's, not ours), and a connection reporting
   * attention before its first push (something it sent could not be applied,
   * and the connector page names it). An empty state that says "nothing" to
   * all three tells the one who already did the work that the work did not
   * take.
   */
  const waitingConnection =
    nothingHasArrived && facts.connections.length > 0
      ? facts.connections[0]
      : undefined;
  const attention =
    waitingConnection?.status.tone === "attention"
      ? waitingConnection
      : undefined;

  return (
    <OverviewCard
      title="Directory"
      chip={directorySyncChipFor(facts.connections)}
      data-testid="directory-card"
      // THE ACTION IS WHATEVER WOULD MOVE THIS ON. No connection: issue a
      // token. A token issued and the first push still out: the connector is
      // the place to check, not another token. After a first push: go see
      // who arrived. Offering "see provisioned members" to somebody with no
      // provisioned members is an invitation to an empty table.
      actions={
        <>
          {nothingHasArrived ? (
            waitingConnection ? (
              <Link href="/settings/authentication/connectors">
                <Button size="sm" variant="outline">
                  Open the connector
                  <ArrowRight size={14} />
                </Button>
              </Link>
            ) : (
              <Link href="/settings/authentication/connectors">
                <Button size="sm" variant="solid" colorPalette="orange">
                  Issue a token
                  <ArrowRight size={14} />
                </Button>
              </Link>
            )
          ) : (
            <Link href="/settings/directory">
              <Button size="sm" variant="outline">
                See who it manages
                <ArrowRight size={14} />
              </Button>
            </Link>
          )}
          {/* The connectors themselves: their state, what they could not
              apply, the address and the token. This card reads; that page
              is where a connector is set up and taken down. */}
          <Link href="/settings/authentication/connectors">
            <Button size="sm" variant="ghost">
              <Settings2 size={14} />
              Edit
            </Button>
          </Link>
        </>
      }
    >
      {/* ROWS OF NOTHING ARE NOT A STATUS. Until a provider has pushed once,
          every fact this card holds is an absence — "0 of 1", "No push yet",
          "No group has arrived yet" — and drawing them as a table makes a
          connection that is merely NEW look like one that is broken. Worse,
          it buries the single thing that would change any of it.

          What it says instead is how far the journey actually got, because
          the card knows: a token that was never issued, one that was and is
          waiting on the provider's schedule, and a connection whose first
          pushes needed attention are three different next moves. */}
      {nothingHasArrived ? (
        <VStack align="start" gap={1} paddingY={1}>
          <Text fontSize="13px" fontWeight="500">
            {waitingConnection
              ? "Waiting for the first push"
              : "Nothing has arrived yet"}
          </Text>
          <Text
            fontSize="11.5px"
            lineHeight="1.55"
            color="fg.muted"
            maxWidth="46ch"
          >
            {attention
              ? `${attention.status.headline} — the connector says what it could not apply.`
              : waitingConnection
                ? "The token is issued and your provider pushes on its own schedule — when the first one lands, members, groups and sync times fill themselves in. Nobody has to sign in for it to work."
                : "Paste a provisioning token into your identity provider and this card keeps itself current — members, groups and sync times arrive and stay in step on their own. Nobody has to sign in for it to work."}
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
                fontVariantNumeric="tabular-nums"
                whiteSpace="nowrap"
                data-testid="directory-card-members"
              >
                {facts.insideDirectory} of {facts.members.length}
              </Text>
            </DirectoryFactUnavailable>
          </OverviewDetail>

          <OverviewDetail label="Last sync">
            <Text whiteSpace="nowrap">
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
            {/* The kit's eyebrow spelling, shared with `MetricStat` — 10.5px,
                uppercase, `fg.subtle` — rather than a size invented here. */}
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
                <Text fontSize="11.5px" color="fg.muted">
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
                    <Text fontSize="11.5px" color="fg.subtle">
                      {`+${restGroups} more`}
                    </Text>
                  )}
                </HStack>
              )}
            </DirectoryFactUnavailable>
          </VStack>

          {/* THE SAME EYEBROW FOR THE ORG STRUCTURE, where there is one.
              Departments are named rather than counted for the same reason
              the groups are, and absent rather than empty when the org has
              none — a "None yet" under a heading a reader cannot act on
              would ask a question this card cannot answer. */}
          {department.show && (
            <VStack align="start" gap={1.5} paddingTop={1} width="full">
              <Text
                fontSize="10.5px"
                fontWeight="600"
                letterSpacing="0.06em"
                textTransform="uppercase"
                color="fg.subtle"
              >
                Departments
              </Text>
              <HStack gap={1} flexWrap="wrap">
                {department.departments.slice(0, GROUPS_SHOWN).map((option) => (
                  <IdentityChip
                    key={option.id}
                    label={option.name}
                    data-testid="directory-card-department-chip"
                  />
                ))}
                {department.departments.length > GROUPS_SHOWN && (
                  <Text fontSize="11.5px" color="fg.subtle">
                    {`+${department.departments.length - GROUPS_SHOWN} more`}
                  </Text>
                )}
              </HStack>
            </VStack>
          )}
        </>
      )}
    </OverviewCard>
  );
}
