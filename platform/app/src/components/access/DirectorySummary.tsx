import {
  Alert,
  Card,
  HStack,
  SimpleGrid,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Boxes, Clock, Plug, Users, UserX } from "lucide-react";
import type { ReactNode } from "react";
import {
  DirectoryFactUnavailable,
  DirectorySourceChips,
} from "~/features/directory/components/DirectoryFacts";
import { useDirectoryFacts } from "~/features/directory/hooks/useDirectoryFacts";
import { isEnterpriseGateError } from "~/features/directory/logic/enterpriseGate";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { SectionErrorNotice } from "../settings/SectionErrorNotice";

/** Sync facts and membership provenance are independent reads. */
export function DirectorySummary({
  organizationId,
  canReadMembership,
}: {
  organizationId: string;
  /** Groups and provenance require organization:manage, beyond sso:view. */
  canReadMembership: boolean;
}) {
  const facts = useDirectoryFacts({ organizationId, canReadMembership });
  const { reconciliation, groups, provenance } = facts;

  if (reconciliation.isError) {
    if (isEnterpriseGateError(reconciliation.error)) {
      return (
        <Alert.Root status="info">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Directory sync is an Enterprise feature</Alert.Title>
            <Alert.Description>
              Connect your identity provider and the people, groups and sync
              status this band reports fill themselves in. Contact sales to
              upgrade.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      );
    }
    return (
      <SectionErrorNotice
        error={reconciliation.error}
        fallbackTitle="Couldn't read your directory"
      />
    );
  }

  if (reconciliation.isLoading) {
    return <DirectorySummarySkeleton />;
  }

  return (
    <VStack align="stretch" gap={3} width="full">
      <SimpleGrid
        columns={{ base: 1, sm: 2, lg: 5 }}
        gap={3}
        data-testid="directory-summary"
      >
        <Fact label="Sources" icon={<Plug size={14} />}>
          <DirectorySourceChips
            connections={facts.connections}
            addHref="/settings/authentication"
          />
        </Fact>
        <Fact label="Last directory change" icon={<Clock size={14} />}>
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
        <Fact
          label="People it manages"
          hint="Counted from the directory itself, so it holds even when the membership cannot be read."
          icon={<Users size={14} />}
        >
          <FactNumber data-testid="directory-managed-people">
            {facts.managedPeople}
          </FactNumber>
        </Fact>
        <Fact label="Groups it sent" icon={<Boxes size={14} />}>
          <DirectoryFactUnavailable canRead={canReadMembership} read={groups}>
            <FactNumber>{facts.directoryGroups.length}</FactNumber>
          </DirectoryFactUnavailable>
        </Fact>
        <Fact
          label="Members it does not manage"
          hint="Your directory did not create these accounts, so removing them there will not remove them here."
          icon={<UserX size={14} />}
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

function DirectorySummarySkeleton() {
  return (
    <SimpleGrid columns={{ base: 1, sm: 2, lg: 5 }} gap={3} width="full">
      {[0, 1, 2, 3, 4].map((tile) => (
        <Card.Root key={tile} borderRadius="xl" minWidth={0}>
          <Card.Body paddingX={4} paddingY={3}>
            <VStack align="start" gap={1.5} minWidth={0}>
              <HStack gap={1.5}>
                <Skeleton height="14px" width="14px" borderRadius="sm" />
                <Skeleton height="3" width="16" />
              </HStack>
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
  /** One small line under the value; on hover it says the whole of it. */
  hint?: string;
  /** A 14px lucide mark beside the label, in the same muted ink. */
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card.Root
      borderRadius="xl"
      minWidth={0}
      transition="border-color 0.15s ease"
      _hover={{ borderColor: "border.emphasized" }}
    >
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
            <Text
              fontSize="xs"
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
