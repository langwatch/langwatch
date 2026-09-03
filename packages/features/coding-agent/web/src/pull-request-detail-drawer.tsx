import { MISSING_VALUE, type DetailPayload } from "./pull-request-detail";
import { PullRequestStatusBadge } from "./pull-request-status-badge";
import { derivePullRequestStatus } from "./pull-request-status";
import { formatShortDate } from "./short-date";
import { Box, Button, Heading, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";
import type React from "react";

import { GitHubIcon } from "@langwatch/design-system/icons";
import { Drawer } from "@langwatch/design-system/drawer";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { formatCost, formatTokens } from "@langwatch/design-system/display-formatters";
import { codingAgentApi as api } from "./coding-agent-api";
import { ContributorsSection } from "./contributors-section";
import { CostBreakdownTooltipContent } from "./cost-breakdown-tooltip";
import { ModelsSection } from "./models-section";
import { SessionsSection } from "./pull-request-sessions-section";

/**
 * One pull request in full: what it cost, who worked on it, what each model
 * consumed, and the sessions that ran on it.
 *
 * Facts only. Nothing here carries a session's title or any of its content:
 * titles are derived content and are gated on the session surfaces that own
 * them, and the read behind this drawer carries none.
 *
 * A contributor is a person when the work ran in their own workspace, and the
 * project itself when it ran in a shared one, where it opens that project's
 * traces.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

export interface PullRequestDetailDrawerProps {
  projectId: string;
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
  /**
   * Takes the drawer back off. The caller owns the address the drawer opens
   * from, so it also owns closing it — the drawer never reaches for a registry
   * that would close every drawer on the stack.
   */
  onClose: () => void;
}

export function PullRequestDetailDrawer({
  projectId,
  repositoryHost,
  repositoryFullName,
  prNumber,
  onClose,
}: PullRequestDetailDrawerProps) {
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
      // Two five-column tables of facts: a narrower drawer cuts the money off
      // the right of both of them.
      size="xl"
      onOpenChange={() => onClose()}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <HStack align="start" width="full" gap={3}>
            <VStack align="start" gap={1} flex={1} minWidth={0}>
              <HStack gap={2}>
                <Text fontSize="sm" fontFamily="mono" color="fg.muted">
                  #{number}
                </Text>
                {detail ? (
                  <PullRequestStatusBadge
                    status={derivePullRequestStatus({
                      state: detail.pullRequest.state,
                      isDraft: detail.pullRequest.isDraft,
                      prMergedAtMs: detail.pullRequest.prMergedAtMs,
                    })}
                    source="payload"
                  />
                ) : null}
              </HStack>
              <Heading size="md">{detail?.pullRequest.title || repositoryFullName}</Heading>
              <Text fontSize="xs" fontFamily="mono" color="fg.subtle">
                {repositoryFullName}
              </Text>
            </VStack>
            {detail ? (
              <Button
                asChild
                flexShrink={0}
                bg={{ base: "gray.900", _dark: "gray.100" }}
                color={{ base: "white", _dark: "gray.900" }}
                _hover={{ bg: { base: "gray.800", _dark: "gray.200" } }}
              >
                <a href={detail.pullRequest.htmlUrl} target="_blank" rel="noopener noreferrer">
                  <GitHubIcon size={16} />
                  Open on GitHub
                </a>
              </Button>
            ) : null}
          </HStack>
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
              <SessionsSection projectId={projectId} sessions={detail.sessions} />
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

const Stat: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
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
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={4}>
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
            // Bundled money is the same list price as any other, so it reads
            // the same and explains itself on hover instead.
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
              {/* The split lives only in the hover, so it gets a tab stop. */}
              <Text fontSize="lg" fontWeight="medium" cursor="help" tabIndex={0}>
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
