import {
  Badge,
  Box,
  Heading,
  HStack,
  Skeleton,
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
import { api } from "~/utils/api";

import { ContributorsSection } from "./pullRequestDetail/ContributorsSection";
import {
  type DetailPayload,
  MISSING_VALUE,
} from "./pullRequestDetail/detailPayload";
import { ModelsSection } from "./pullRequestDetail/ModelsSection";
import { SessionsSection } from "./pullRequestDetail/SessionsSection";
import { formatShortDate } from "./shortDate";

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
      // Two five-column tables of facts: a narrower drawer cuts the money off
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

/** The stored snapshot's own reading of where the pull request stands. */
function statusOf(
  pullRequest: DetailPayload["pullRequest"],
): PullRequestStatus {
  if (pullRequest.prMergedAtMs !== null) return "merged";
  if (pullRequest.prClosedAtMs !== null) return "closed";
  if (pullRequest.isDraft) return "draft";
  return "open";
}

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
              <Text
                fontSize="lg"
                fontWeight="medium"
                cursor="help"
                tabIndex={0}
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
