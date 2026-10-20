import { Link } from "@langwatch/browser-host/link";
import { UpgradeRequired } from "@langwatch/design-system/access-state";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Directory page's status band: which sources are connected, when the last
 * push landed, how many people it manages, the groups it sent and the members
 * it does not manage. Lent to organization's Directory through `withCapabilities`.
 * Spec: specs/identity/directory-administration.feature
 */
import { Card } from "@langwatch/design-system/card";
import {
  Box,
  Button,
  Grid,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { StatusChip, type StatusChipTone } from "@langwatch/design-system/settings-card";
import { StatTileFigure } from "@langwatch/design-system/stat-tile";
import type { DirectorySummaryProps } from "@langwatch/enterprise-scim-client";
import { HandledErrorAlert } from "@langwatch/error-views";
import { nowInstant, readableDate } from "@langwatch/time";
import { Boxes, Clock, Plug, Users, UserX } from "lucide-react";
import type { ReactNode } from "react";

import { useDirectoryFacts } from "../../behavior/use-directory-facts.ts";
import { relativeTime } from "../../model/display-formatters.ts";
import { isEnterpriseGateError } from "../../model/enterprise-gate.ts";

const AUTHENTICATION_PAGE = "/settings/authentication";

type DirectoryFactsRead = ReturnType<typeof useDirectoryFacts>;

export default function DirectorySummary({
  organizationId,
  canReadMembership,
}: DirectorySummaryProps) {
  const facts = useDirectoryFacts({ organizationId, canReadMembership });
  const { reconciliation } = facts;

  if (reconciliation.isError) {
    if (isEnterpriseGateError(reconciliation.error)) return <EnterpriseGate />;
    return (
      <HandledErrorAlert
        error={reconciliation.error}
        fallbackTitle="Couldn't read your directory"
        onRetry={() => void reconciliation.refetch()}
      />
    );
  }
  if (reconciliation.isLoading) return <DirectorySummarySkeleton />;

  return (
    <VStack align="stretch" gap={3} width="full">
      <Card data-testid="directory-summary" padding="none" bodyLayout="stack">
        <DirectorySources connections={facts.connections} />
        <Grid templateColumns={{ base: "1fr", lg: "repeat(4, minmax(0, 1fr))" }}>
          <Fact label="Last directory change" icon={<Clock size={14} />}>
            <FactNumber
              muted={facts.lastPushedAtMs === null}
              title={
                facts.lastPushedAtMs === null
                  ? void 0
                  : readableDate(facts.lastPushedAtMs).toLocaleString()
              }
            >
              {facts.lastPushedAtMs === null
                ? "No push yet"
                : relativeTime({
                    atMs: facts.lastPushedAtMs,
                    nowMs: nowInstant().epochMilliseconds,
                  })}
            </FactNumber>
          </Fact>
          <Fact
            label="People it manages"
            hint="Counted from the directory itself, so it holds even when the membership cannot be read."
            icon={<Users size={14} />}
            divided
          >
            <FactNumber data-testid="directory-managed-people">{facts.managedPeople}</FactNumber>
          </Fact>
          <Fact label="Groups it sent" icon={<Boxes size={14} />} divided>
            <Unavailable canRead={canReadMembership} read={facts.groups}>
              <FactNumber data-testid="directory-groups-sent">
                {facts.directoryGroups.length}
              </FactNumber>
            </Unavailable>
          </Fact>
          <MembersOutsideDirectory facts={facts} canReadMembership={canReadMembership} />
        </Grid>
      </Card>
      {facts.groups.isError && (
        <HandledErrorAlert
          error={facts.groups.error}
          fallbackTitle="Couldn't count the groups your directory sent"
        />
      )}
      {facts.provenance.isError && (
        <HandledErrorAlert
          error={facts.provenance.error}
          fallbackTitle="Couldn't work out which members your directory manages"
        />
      )}
    </VStack>
  );
}

/** A plan state, not a failure: said as an upsell, as the directory band does on main. */
function EnterpriseGate() {
  return (
    <UpgradeRequired
      feature="Directory sync"
      data-testid="directory-enterprise-gate"
      actions={
        <Button asChild colorPalette="orange" size="sm">
          <Link href="/settings/plans">Compare plans</Link>
        </Button>
      }
    />
  );
}

function MembersOutsideDirectory({
  facts,
  canReadMembership,
}: {
  facts: DirectoryFactsRead;
  canReadMembership: boolean;
}) {
  return (
    <Fact
      label="Not managed by directory"
      hint="Your directory did not create these accounts, so removing them there will not remove them here."
      icon={<UserX size={14} />}
      divided
    >
      <Unavailable canRead={canReadMembership} read={facts.provenance}>
        <FactNumber data-testid="members-outside-directory">
          {facts.outsideDirectory} of {facts.memberCount}
        </FactNumber>
      </Unavailable>
    </Fact>
  );
}

/** The running connections, each with its state; none says nobody arrives on their own. */
function DirectorySources({ connections }: { connections: DirectoryFactsRead["connections"] }) {
  const none = connections.length === 0;
  return (
    <HStack
      gap={3}
      rowGap={2}
      flexWrap="wrap"
      align="center"
      paddingX={4}
      paddingY={3}
      data-testid="directory-sources"
    >
      <HStack gap={1.5} color="fg.muted" flexShrink={0}>
        <Plug size={14} />
        <Text fontSize="xs" fontWeight={500} lineHeight="1.3">
          Sources
        </Text>
      </HStack>
      <HStack gap={1.5} flexWrap="wrap" minWidth={0} maxWidth="full">
        {none ? (
          <StatusChip
            label="Not set up"
            title="No identity provider is connected, so nothing is provisioned here automatically."
            data-testid="directory-source-chip"
          />
        ) : (
          connections.map((connection) => (
            <HStack
              key={connection.connectionId}
              gap={1.5}
              minWidth={0}
              maxWidth="full"
              data-testid="directory-source"
            >
              <Text fontSize="xs" fontWeight={500} minWidth={0} overflowWrap="anywhere">
                {connection.providerId}
              </Text>
              <Box flexShrink={0}>
                <StatusChip
                  label={connection.status.headline}
                  tone={sourceTone(connection.status.tone)}
                  title={connection.status.headline}
                  data-testid="directory-source-chip"
                />
              </Box>
            </HStack>
          ))
        )}
      </HStack>
      <Text asChild fontSize="xs" color="orange.fg">
        <Link
          unstyled
          href={AUTHENTICATION_PAGE}
          data-testid={none ? "connect-identity-provider" : "manage-identity-providers"}
        >
          {none ? "Connect a provider →" : "Manage identity providers →"}
        </Link>
      </Text>
    </HStack>
  );
}

function sourceTone(tone: string): StatusChipTone {
  if (tone === "working") return "good";
  if (tone === "attention") return "warning";
  return "neutral";
}

/** A fact this reader cannot have, said as a word: a zero would read as an answer. */
function Unavailable({
  canRead,
  read,
  children,
}: {
  canRead: boolean;
  read: { isLoading: boolean; isError: boolean };
  children: ReactNode;
}) {
  if (!canRead || read.isError) {
    return (
      <Text
        fontSize="sm"
        color="fg.muted"
        title={canRead ? void 0 : "Not yours to read."}
        data-testid="directory-fact-unavailable"
      >
        Unavailable
      </Text>
    );
  }
  if (read.isLoading) return <Skeleton height="3.5" width="24" />;
  return <>{children}</>;
}

function DirectorySummarySkeleton() {
  return (
    <Card padding="none" bodyLayout="stack" data-testid="directory-summary-loading">
      <Box paddingX={4} paddingY={3}>
        <Skeleton height="3.5" width="48" />
      </Box>
      <Grid templateColumns={{ base: "1fr", lg: "repeat(4, minmax(0, 1fr))" }} aria-busy="true">
        {[0, 1, 2, 3].map((fact) => (
          <VStack
            key={fact}
            align="start"
            gap={1.5}
            paddingX={4}
            paddingY={3}
            borderTopWidth="1px"
            borderStartWidth={{ base: 0, lg: fact === 0 ? 0 : "1px" }}
            borderColor="border.muted"
          >
            <Skeleton height="3" width="16" />
            <Skeleton height="5" width="24" />
          </VStack>
        ))}
      </Grid>
    </Card>
  );
}

/** One independently readable fact in the band, set off from its neighbour by a hairline. */
function Fact({
  label,
  hint,
  icon,
  divided = false,
  children,
}: {
  label: string;
  hint?: string;
  icon: ReactNode;
  /** Not the first fact: a hairline on its leading edge where the band is a row. */
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <VStack
      align="start"
      gap={1.5}
      minWidth={0}
      paddingX={4}
      paddingY={3}
      borderTopWidth="1px"
      borderStartWidth={{ base: 0, lg: divided ? "1px" : 0 }}
      borderColor="border.muted"
    >
      <HStack gap={1.5} color="fg.muted">
        {icon}
        <Text fontSize="xs" fontWeight={500} lineHeight="1.3">
          {label}
        </Text>
      </HStack>
      <HStack align="center" minWidth={0} maxWidth="full">
        {children}
      </HStack>
      {hint && (
        <Text fontSize="xs" color="fg.muted" lineHeight="1.35">
          {hint}
        </Text>
      )}
    </VStack>
  );
}

const FactNumber = StatTileFigure;
