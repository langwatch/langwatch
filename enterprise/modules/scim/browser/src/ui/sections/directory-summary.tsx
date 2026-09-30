// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Directory page's status band: which sources are connected, when the last
 * push landed, how many people it manages, the groups it sent and the members
 * it does not manage. Lent to organization's Directory through `withCapabilities`.
 * Spec: specs/identity/directory-administration.feature
 */
import { Alert, Card, HStack, SimpleGrid, Skeleton, Text, VStack } from "@chakra-ui/react";
import type { UiDirectorySummaryProps } from "@langwatch/browser-host/declarations";
import { Link } from "@langwatch/browser-host/link";
import { StatusChip, type StatusChipTone } from "@langwatch/design-system/settings-card";
import { HandledErrorAlert } from "@langwatch/error-views";
import { nowInstant } from "@langwatch/time";
import { Boxes, Clock, Plug, Plus, Users, UserX } from "lucide-react";
import type { ReactNode } from "react";

import { useDirectoryFacts } from "../../behavior/use-directory-facts.ts";
import { readableDate, relativeTime } from "../../model/display-formatters.ts";
import { isEnterpriseGateError } from "../../model/enterprise-gate.ts";

/** Sources named before the rest collapse into a count. */
const SOURCES_SHOWN = 3;
const AUTHENTICATION_PAGE = "/settings/authentication";

type DirectoryFactsRead = ReturnType<typeof useDirectoryFacts>;

export default function DirectorySummary({
  organizationId,
  canReadMembership,
}: UiDirectorySummaryProps) {
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
      <SimpleGrid columns={{ base: 1, sm: 2, lg: 5 }} gap={3} data-testid="directory-summary">
        <Fact label="Sources" icon={<Plug size={14} />}>
          <DirectorySources connections={facts.connections} />
        </Fact>
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
              : relativeTime({ atMs: facts.lastPushedAtMs, nowMs: nowInstant().epochMilliseconds })}
          </FactNumber>
        </Fact>
        <Fact
          label="People it manages"
          hint="Counted from the directory itself, so it holds even when the membership cannot be read."
          icon={<Users size={14} />}
        >
          <FactNumber data-testid="directory-managed-people">{facts.managedPeople}</FactNumber>
        </Fact>
        <Fact label="Groups it sent" icon={<Boxes size={14} />}>
          <Unavailable canRead={canReadMembership} read={facts.groups}>
            <FactNumber>{facts.directoryGroups.length}</FactNumber>
          </Unavailable>
        </Fact>
        <MembersOutsideDirectory facts={facts} canReadMembership={canReadMembership} />
      </SimpleGrid>
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
    <Alert.Root status="info" data-testid="directory-enterprise-gate">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Directory sync is an Enterprise feature</Alert.Title>
        <Alert.Description>
          Connect your identity provider and the people, groups and sync status this band reports
          fill themselves in. Contact sales to upgrade.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
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
      label="Members it does not manage"
      hint="Your directory did not create these accounts, so removing them there will not remove them here."
      icon={<UserX size={14} />}
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
  if (connections.length === 0) {
    return (
      <VStack align="start" gap={1}>
        <StatusChip
          label="Not set up yet"
          title="No identity provider is connected, so nothing is provisioned here automatically."
          data-testid="directory-source-chip"
        />
        <Text fontSize="xs" color="fg.muted">
          Nobody is provisioned here automatically.
        </Text>
        <Text asChild fontSize="xs" color="orange.fg">
          <Link unstyled href={AUTHENTICATION_PAGE} data-testid="connect-identity-provider">
            Connect an identity provider →
          </Link>
        </Text>
      </VStack>
    );
  }

  const shown = connections.slice(0, SOURCES_SHOWN);
  const rest = connections.length - shown.length;
  return (
    <HStack gap={1} flexWrap="wrap">
      {shown.map((connection) => (
        <StatusChip
          key={connection.connectionId}
          label={`${connection.providerId} · ${connection.status.headline}`}
          tone={sourceTone(connection.status.tone)}
          title={connection.status.headline}
          data-testid="directory-source-chip"
        />
      ))}
      {rest > 0 && <Text fontSize="xs" color="fg.muted">{`+${rest} more`}</Text>}
      <Link
        unstyled
        href={AUTHENTICATION_PAGE}
        aria-label="Connect another identity provider"
        title="Connect another identity provider"
      >
        <Plus size={16} />
      </Link>
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
    <SimpleGrid columns={{ base: 1, sm: 2, lg: 5 }} gap={3} width="full" aria-busy="true">
      {[0, 1, 2, 3, 4].map((tile) => (
        <Card.Root key={tile} borderRadius="xl" minWidth={0}>
          <Card.Body paddingX={4} paddingY={3}>
            <VStack align="start" gap={1.5} minWidth={0}>
              <Skeleton height="3" width="16" />
              <Skeleton height="5" width="24" />
            </VStack>
          </Card.Body>
        </Card.Root>
      ))}
    </SimpleGrid>
  );
}

/** One independently readable directory fact. */
function Fact({
  label,
  hint,
  icon,
  children,
}: {
  label: string;
  hint?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card.Root borderRadius="xl" minWidth={0}>
      <Card.Body paddingX={4} paddingY={3}>
        <VStack align="start" gap={1.5} minWidth={0}>
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
            <Text fontSize="xs" color="fg.muted" lineHeight="1.35" title={hint} lineClamp={2}>
              {hint}
            </Text>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/** A fact that is a number, or a phrase in its place: the tile's big figure. */
function FactNumber({
  children,
  muted = false,
  title,
  "data-testid": testId,
}: {
  children: ReactNode;
  muted?: boolean;
  title?: string;
  "data-testid"?: string;
}) {
  return (
    <Text
      fontSize="lg"
      lineHeight="1.3"
      fontWeight={muted ? 400 : 600}
      color={muted ? "fg.muted" : void 0}
      fontVariantNumeric="tabular-nums"
      truncate
      maxWidth="full"
      title={title}
      data-testid={testId}
    >
      {children}
    </Text>
  );
}
