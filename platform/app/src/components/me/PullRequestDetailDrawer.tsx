import {
  Badge,
  Box,
  Heading,
  HStack,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import numeral from "numeral";
import type React from "react";

import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { CostBreakdownTooltipContent } from "~/features/traces-v2/components/shared/CostBreakdownTooltip";
import {
  formatCost,
  formatTokens,
} from "~/features/traces-v2/utils/formatters";
import { useDrawer } from "~/hooks/useDrawer";
import { api, type RouterOutputs } from "~/utils/api";

import { formatShortDate } from "./shortDate";

/**
 * One pull request in full: what it cost, who worked on it, what each model
 * consumed, and the sessions that ran on it.
 *
 * Facts only. The sessions section lists start times, contributors, projects,
 * agents, tokens and cost, and deliberately never a session's title or any of
 * its content: titles are derived content and are gated on the session
 * surfaces that own them. The read behind this drawer carries none, so there
 * is nothing here to leak.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

/** The placeholder for a value a row does not have. */
const MISSING_VALUE = "—";

/** What a contributor is called when the agent reported no identity. */
const UNATTRIBUTED = "Unattributed";

type PullRequestStatus = "open" | "draft" | "merged" | "closed";

const STATUS_LABELS: Record<PullRequestStatus, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

const STATUS_PALETTES: Record<PullRequestStatus, string> = {
  open: "green",
  draft: "gray",
  merged: "orange",
  closed: "red",
};

export interface PullRequestDetailDrawerProps {
  projectId: string;
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
}

export function PullRequestDetailDrawer({
  projectId,
  repositoryHost,
  repositoryFullName,
  prNumber,
}: PullRequestDetailDrawerProps) {
  const { closeDrawer } = useDrawer();
  // The drawer's own state lives in the URL, which carries every value as
  // text, so the number the table opened it with arrives back as a string.
  // The read takes a number and rejects anything else, so the coercion has to
  // happen before the query rather than in the caller that opened the drawer.
  const number = Number(prNumber);
  const hasNumber = Number.isInteger(number) && number > 0;
  const detailQuery = api.codingAgents.pullRequestDetail.useQuery(
    { projectId, repositoryHost, repositoryFullName, prNumber: number },
    { enabled: !!projectId && hasNumber, refetchOnWindowFocus: false },
  );

  const detail = detailQuery.data;

  return (
    <Drawer.Root
      open={true}
      placement="end"
      // Two six-column tables of facts: a narrower drawer cuts the money off
      // the right of both of them.
      size="xl"
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <VStack align="start" gap={1} width="full">
            <HStack gap={2}>
              <Text fontSize="sm" fontFamily="mono" color="fg.muted">
                #{number}
              </Text>
              {detail ? (
                <Badge
                  size="sm"
                  colorPalette={STATUS_PALETTES[statusOf(detail.pullRequest)]}
                >
                  {STATUS_LABELS[statusOf(detail.pullRequest)]}
                </Badge>
              ) : null}
            </HStack>
            <Heading size="md">
              {detail?.pullRequest.title || repositoryFullName}
            </Heading>
            <HStack gap={3}>
              <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
                {repositoryFullName}
              </Text>
              {detail ? (
                <Link
                  href={detail.pullRequest.htmlUrl}
                  isExternal
                  color="blue.fg"
                  fontSize="xs"
                >
                  <HStack gap={1}>
                    <Text>Open on GitHub</Text>
                    <ExternalLink size={12} />
                  </HStack>
                </Link>
              ) : null}
            </HStack>
          </VStack>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {detailQuery.isLoading ? (
            <VStack align="stretch" gap={4}>
              <Skeleton height="72px" borderRadius="md" />
              <Skeleton height="160px" borderRadius="md" />
              <Skeleton height="160px" borderRadius="md" />
            </VStack>
          ) : detailQuery.isError || !detail ? (
            <Text fontSize="sm" color="fg.error">
              Couldn&apos;t load this pull request
            </Text>
          ) : (
            <VStack align="stretch" gap={6}>
              <SummaryRow detail={detail} />
              <ContributorsSection contributors={detail.contributors} />
              <ModelsSection models={detail.modelBreakdown} />
              <SessionsSection sessions={detail.sessions} />
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

type DetailPayload = RouterOutputs["codingAgents"]["pullRequestDetail"];

/** The stored snapshot's own reading of where the pull request stands. */
function statusOf(
  pullRequest: DetailPayload["pullRequest"],
): PullRequestStatus {
  if (pullRequest.prMergedAtMs !== null) return "merged";
  if (pullRequest.prClosedAtMs !== null) return "closed";
  if (pullRequest.isDraft) return "draft";
  return "open";
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <VStack align="stretch" gap={2}>
    <Heading size="sm">{title}</Heading>
    {children}
  </VStack>
);

const EmptySection: React.FC<{ children: string }> = ({ children }) => (
  <Text fontSize="sm" color="fg.muted">
    {children}
  </Text>
);

const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <VStack align="start" gap={0} flex={1} minWidth="120px">
    <Text fontSize="xs" color="fg.muted">
      {label}
    </Text>
    {children}
  </VStack>
);

const SummaryRow: React.FC<{ detail: DetailPayload }> = ({ detail }) => {
  const totals = detail.totals;
  const nonBilled = totals.nonBilledCostUsd ?? 0;
  const isBundled = nonBilled > 0;

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
    >
      <HStack align="start" gap={6} wrap="wrap">
        <Stat label="Sessions">
          <Text fontSize="lg" fontWeight="medium">
            {numeral(totals.sessionsCount).format("0,0")}
          </Text>
        </Stat>
        <Stat label="Tokens">
          <Text fontSize="lg" fontWeight="medium">
            {formatTokens(totals.totalTokens)}
          </Text>
        </Stat>
        <Stat label="Token cost">
          {totals.costUsd === null ? (
            <Text fontSize="lg" fontWeight="medium" color="fg.subtle">
              {MISSING_VALUE}
            </Text>
          ) : isBundled ? (
            <Tooltip
              content={
                <CostBreakdownTooltipContent
                  isBundled
                  billedCost={totals.billedCostUsd ?? 0}
                  nonBilledCost={nonBilled}
                  grandCost={totals.costUsd}
                />
              }
            >
              <Text
                fontSize="lg"
                fontWeight="medium"
                color="purple.fg"
                cursor="help"
              >
                {formatCost(totals.costUsd)}
              </Text>
            </Tooltip>
          ) : (
            <Text fontSize="lg" fontWeight="medium">
              {formatCost(totals.costUsd)}
            </Text>
          )}
        </Stat>
        <Stat label="Opened">
          <Text fontSize="lg" fontWeight="medium">
            {formatShortDate({
              timestampMs: detail.pullRequest.prCreatedAtMs,
            })}
          </Text>
        </Stat>
      </HStack>
    </Box>
  );
};

/**
 * The width the agent-reported identity is allowed to take.
 *
 * An agent names its user however it likes, and several report a long unbroken
 * hash. Left alone that one value sizes the whole table past the drawer and
 * pushes the numbers out of sight, so the column is bounded and anything
 * longer is cut with the whole value on hover.
 */
const CONTRIBUTOR_COLUMN_WIDTH = "180px";

const ContributorsSection: React.FC<{
  contributors: DetailPayload["contributors"];
}> = ({ contributors }) => (
  <Section title="Contributors">
    {contributors.length === 0 ? (
      <EmptySection>No sessions ran on this pull request yet</EmptySection>
    ) : (
      <Table.ScrollArea>
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Contributor</Table.ColumnHeader>
              <Table.ColumnHeader>Project</Table.ColumnHeader>
              <Table.ColumnHeader>Agent</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Sessions</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Tokens</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                Token cost
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {contributors.map((contributor) => (
              <Table.Row
                key={`${contributor.projectId} ${contributor.userLabel} ${contributor.agent}`}
              >
                <Table.Cell
                  fontSize="sm"
                  maxWidth={CONTRIBUTOR_COLUMN_WIDTH}
                  truncate
                  title={contributor.userLabel || UNATTRIBUTED}
                >
                  {contributor.userLabel || UNATTRIBUTED}
                </Table.Cell>
                <Table.Cell fontSize="sm" color="fg.muted">
                  {contributor.projectName}
                </Table.Cell>
                <Table.Cell fontSize="sm" color="fg.muted">
                  {contributor.agent || MISSING_VALUE}
                </Table.Cell>
                <Table.Cell textAlign="end" fontSize="sm">
                  {numeral(contributor.sessionsCount).format("0,0")}
                </Table.Cell>
                <Table.Cell textAlign="end" fontSize="sm">
                  {formatTokens(contributor.totalTokens)}
                </Table.Cell>
                <Table.Cell
                  textAlign="end"
                  fontSize="sm"
                  color={
                    (contributor.nonBilledCostUsd ?? 0) > 0
                      ? "purple.fg"
                      : undefined
                  }
                >
                  {contributor.costUsd === null
                    ? MISSING_VALUE
                    : formatCost(contributor.costUsd)}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
    )}
  </Section>
);

const ModelsSection: React.FC<{
  models: DetailPayload["modelBreakdown"];
}> = ({ models }) => {
  const peak = models.reduce(
    (max, model) => Math.max(max, model.totalTokens),
    0,
  );
  return (
    <Section title="Models">
      {models.length === 0 ? (
        <EmptySection>
          No per-call model data for this pull request yet
        </EmptySection>
      ) : (
        <VStack align="stretch" gap={3}>
          {models.map((model) => (
            <VStack key={model.model} align="stretch" gap={1}>
              <HStack justify="space-between" gap={3}>
                <Text fontSize="sm" truncate>
                  {model.model}
                </Text>
                <HStack gap={3} flexShrink={0}>
                  <Text fontSize="sm" color="fg.muted">
                    {formatTokens(model.totalTokens)} tokens
                  </Text>
                  <Text fontSize="sm" color="fg.muted">
                    {model.costUsd === null
                      ? MISSING_VALUE
                      : formatCost(model.costUsd)}
                  </Text>
                </HStack>
              </HStack>
              <Box
                height="3px"
                bg="border.subtle"
                borderRadius="full"
                overflow="hidden"
              >
                <Box
                  height="full"
                  width={`${peak > 0 ? (model.totalTokens / peak) * 100 : 0}%`}
                  bg="blue.fg"
                  borderRadius="full"
                />
              </Box>
            </VStack>
          ))}
        </VStack>
      )}
    </Section>
  );
};

const SessionsSection: React.FC<{
  sessions: DetailPayload["sessions"];
}> = ({ sessions }) => (
  <Section title="Sessions">
    {sessions.length === 0 ? (
      <EmptySection>No sessions ran on this pull request yet</EmptySection>
    ) : (
      <Table.ScrollArea>
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Started</Table.ColumnHeader>
              <Table.ColumnHeader>Contributor</Table.ColumnHeader>
              <Table.ColumnHeader>Project</Table.ColumnHeader>
              <Table.ColumnHeader>Agent</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Tokens</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                Token cost
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sessions.map((session) => (
              <Table.Row key={session.sessionId}>
                <Table.Cell fontSize="sm" whiteSpace="nowrap">
                  {formatShortDate({ timestampMs: session.startedAtMs })}{" "}
                  {new Date(session.startedAtMs).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Table.Cell>
                <Table.Cell
                  fontSize="sm"
                  maxWidth={CONTRIBUTOR_COLUMN_WIDTH}
                  truncate
                  title={session.userLabel || UNATTRIBUTED}
                >
                  {session.userLabel || UNATTRIBUTED}
                </Table.Cell>
                <Table.Cell fontSize="sm" color="fg.muted">
                  {session.projectName}
                </Table.Cell>
                <Table.Cell fontSize="sm" color="fg.muted">
                  {session.agent || MISSING_VALUE}
                </Table.Cell>
                <Table.Cell textAlign="end" fontSize="sm">
                  {formatTokens(session.totalTokens)}
                </Table.Cell>
                <Table.Cell textAlign="end" fontSize="sm">
                  {session.costUsd === null
                    ? MISSING_VALUE
                    : formatCost(session.costUsd)}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
    )}
  </Section>
);
