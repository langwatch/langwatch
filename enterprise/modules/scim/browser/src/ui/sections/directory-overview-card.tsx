// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * How accounts arrive, beside how people sign in: how much of the membership
 * the directory owns, whether it is still running, and what it sent. Declared
 * through `withCapabilities`. Spec: specs/identity/organization-authentication-settings.feature
 */
import { Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { OverviewCard, OverviewDetail, StatusChip } from "@langwatch/design-system/settings-card";
import { nowInstant } from "@langwatch/time";
import { ArrowRight, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { useDirectoryFacts } from "../../behavior/use-directory-facts.ts";
import { directorySyncChipFor } from "../../model/directory-sync-chip.ts";
import { relativeTime } from "../../model/display-formatters.ts";
import { CONNECTORS_PAGE } from "../../model/scim-host.ts";

/** Groups named before the rest collapse into a count. */
const GROUPS_SHOWN = 4;
const DIRECTORY_PAGE = "/settings/members?people=members";

type DirectoryFactsRead = ReturnType<typeof useDirectoryFacts>;
type WaitingConnection = DirectoryFactsRead["connections"][number];

export function DirectoryOverviewCard({
  organizationId,
  canReadMembership,
}: {
  organizationId: string;
  canReadMembership: boolean;
}) {
  const facts = useDirectoryFacts({ organizationId, canReadMembership });
  const { reconciliation } = facts;

  if (reconciliation.isError) {
    return (
      <OverviewCard title="Directory" data-testid="directory-card">
        <DirectoryReadFailure />
      </OverviewCard>
    );
  }

  if (reconciliation.isLoading) {
    return (
      <OverviewCard title="Directory" data-testid="directory-card">
        <VStack align="stretch" gap={2} paddingY={2} aria-busy="true" aria-label="Loading">
          <Skeleton height="12px" width="38%" />
          <Skeleton height="12px" width="30%" />
        </VStack>
      </OverviewCard>
    );
  }

  const nothingHasArrived = facts.lastPushedAtMs === null;
  const waiting = nothingHasArrived ? facts.connections[0] : void 0;
  const attention = waiting?.status.tone === "attention" ? waiting : void 0;

  return (
    <OverviewCard
      title="Directory"
      chip={directorySyncChipFor(facts.connections)}
      data-testid="directory-card"
      actions={<DirectoryCardActions waiting={waiting} nothingHasArrived={nothingHasArrived} />}
    >
      {nothingHasArrived ? (
        <DirectoryCardWaiting waiting={waiting} attention={attention} />
      ) : (
        <DirectoryCardFacts facts={facts} canReadMembership={canReadMembership} />
      )}
    </OverviewCard>
  );
}

export default DirectoryOverviewCard;

/** The read failed: said on the card, never drawn as an empty directory. */
function DirectoryReadFailure() {
  return (
    <Text fontSize="13px" color="fg.muted" data-testid="directory-card-failure">
      Couldn&apos;t read your directory. Try again in a moment.
    </Text>
  );
}

/** Whatever would move this card on: issue a token, check the connector, or see who arrived. */
function DirectoryCardActions({
  waiting,
  nothingHasArrived,
}: {
  waiting: WaitingConnection | undefined;
  nothingHasArrived: boolean;
}) {
  return (
    <>
      {nothingHasArrived ? (
        <Button
          asChild
          size="sm"
          variant={waiting ? "outline" : "solid"}
          colorPalette={waiting ? void 0 : "orange"}
        >
          <a href={CONNECTORS_PAGE}>
            {waiting ? "Open the connector" : "Issue a token"}
            <ArrowRight size={14} />
          </a>
        </Button>
      ) : (
        <Button asChild size="sm" variant="outline">
          <a href={DIRECTORY_PAGE}>
            See who it manages
            <ArrowRight size={14} />
          </a>
        </Button>
      )}
      <Button asChild size="sm" variant="ghost">
        <a href={CONNECTORS_PAGE}>
          <Settings2 size={14} />
          Edit
        </a>
      </Button>
    </>
  );
}

/** Three states, not one: an empty state saying "nothing" to all three misleads two of them. */
function waitingWords({
  waiting,
  attention,
}: {
  waiting: WaitingConnection | undefined;
  attention: WaitingConnection | undefined;
}): string {
  if (attention) return `${attention.status.headline}: the connector says what it could not apply.`;
  if (waiting) {
    return "Your provider pushes on its own schedule. When the first one lands, members, groups and sync times fill themselves in. Nobody has to sign in for it to work.";
  }
  return "Paste a provisioning token into your identity provider and this card keeps itself current: members, groups and sync times arrive and stay in step on their own. Nobody has to sign in for it to work.";
}

/** Before any provider has pushed: no connection, one waiting, or one needing attention. */
function DirectoryCardWaiting({
  waiting,
  attention,
}: {
  waiting: WaitingConnection | undefined;
  attention: WaitingConnection | undefined;
}) {
  return (
    <VStack align="start" gap={1} paddingY={1}>
      <Text fontSize="13px" fontWeight="500">
        {waiting ? "Waiting for the first push" : "Nothing has arrived yet"}
      </Text>
      <Text fontSize="11.5px" lineHeight="1.55" color="fg.muted" maxWidth="46ch">
        {waitingWords({ waiting, attention })}
      </Text>
    </VStack>
  );
}

function DirectoryCardFacts({
  facts,
  canReadMembership,
}: {
  facts: DirectoryFactsRead;
  canReadMembership: boolean;
}) {
  const shownGroups = facts.directoryGroups.slice(0, GROUPS_SHOWN);
  const restGroups = facts.directoryGroups.length - shownGroups.length;

  return (
    <>
      <OverviewDetail
        label="Members it manages"
        hint={
          canReadMembership && facts.outsideDirectory > 0
            ? `${facts.outsideDirectory} arrived another way, so removing them from your identity provider will not remove them here.`
            : void 0
        }
      >
        <FactUnavailable canRead={canReadMembership} read={facts.provenance}>
          <Text
            fontVariantNumeric="tabular-nums"
            whiteSpace="nowrap"
            data-testid="directory-card-members"
          >
            {facts.insideDirectory} of {facts.memberCount}
          </Text>
        </FactUnavailable>
      </OverviewDetail>

      <OverviewDetail label="Last directory change">
        <Text whiteSpace="nowrap">
          {facts.lastPushedAtMs === null
            ? "No push yet"
            : relativeTime({ atMs: facts.lastPushedAtMs, nowMs: nowInstant().epochMilliseconds })}
        </Text>
      </OverviewDetail>

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
        <FactUnavailable canRead={canReadMembership} read={facts.groups}>
          {facts.directoryGroups.length === 0 ? (
            <Text fontSize="11.5px" color="fg.muted">
              None yet
            </Text>
          ) : (
            <HStack gap={1} flexWrap="wrap">
              {shownGroups.map((group) => (
                <StatusChip
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
        </FactUnavailable>
      </VStack>
    </>
  );
}

/** A fact this reader cannot have, said as a word: a zero would read as an answer. */
function FactUnavailable({
  canRead,
  read,
  children,
}: {
  canRead: boolean;
  read: { isLoading: boolean; isError: boolean };
  children: ReactNode;
}) {
  if (!canRead) {
    return (
      <Text
        fontSize="sm"
        color="fg.muted"
        title="Not yours to read."
        data-testid="directory-fact-unavailable"
      >
        Unavailable
      </Text>
    );
  }
  if (read.isError) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Unavailable
      </Text>
    );
  }
  if (read.isLoading) return <Skeleton height="3.5" width="24" />;
  return <>{children}</>;
}
