import { Badge, Button, Skeleton, Table, Text, VStack } from "@chakra-ui/react";
import { GitPullRequest, MoreVertical } from "lucide-react";
import numeral from "numeral";
import type React from "react";
import { useMemo, useState } from "react";

import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { ListTable } from "~/components/ui/ListTable";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { Pagination } from "~/components/ui/Pagination";
import { Tooltip } from "~/components/ui/tooltip";
import { CostBreakdownTooltipContent } from "~/features/traces-v2/components/shared/CostBreakdownTooltip";
import {
  formatCost,
  formatTokens,
} from "~/features/traces-v2/utils/formatters";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

import {
  PeerComparisonCell,
  peerComparisonSentence,
} from "./PeerComparisonCell";
import { percentileStats } from "./percentile";
import { formatShortDate } from "./shortDate";

/**
 * What each pull request cost in assistant usage.
 *
 * Every row covers the pull request's whole lifetime: the sessions that ran on
 * its branch before it was opened count toward it too, and nothing here is
 * scoped to a time window. Which pull requests appear is a personal question
 * (the ones this project's own work touched); what each one cost is answered
 * across every project the viewer may read. Branches whose pull request has
 * not been opened yet are listed underneath rather than dropped, and stay the
 * viewer's own work.
 *
 * Every numeric column reads the same way: the value, and a thin bar under it
 * saying how the row compares to the other rows on this page. Whether the
 * token cost was really spent or covered by a bundled plan is a detail of the
 * money rather than a different kind of number, so it lives in the value's
 * tooltip and never in its color.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

/**
 * Most pull requests one status read may ask about, matching the read's own
 * cap. Asking beyond it is refused, so the table reads status for the rows it
 * is showing and leaves the rest unlabelled rather than failing the page.
 */
const MAX_LIVE_STATUS_REFS = 50;

/** How long a status answer is reused before the table asks again. */
const STATUS_STALE_TIME_MS = 60_000;

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

type PullRequestStatus = "open" | "draft" | "merged" | "closed";

interface LiveStatus {
  status: PullRequestStatus;
  source: "live" | "snapshot";
  mappedAt: Date | null;
}

/** The whole read, as the tRPC procedure defines it. */
type UsagePayload = RouterOutputs["codingAgents"]["pullRequestUsage"];

/** One mapped pull request, as the read hands it over. */
type MappedPullRequestPayload = UsagePayload["rows"][number];

/** One branch whose pull request has not been opened (or mapped) yet. */
type UnlinkedBranchPayload = UsagePayload["unlinked"][number];

/** What one model consumed on a pull request. */
type ModelUsage = MappedPullRequestPayload["modelBreakdown"][number];

/**
 * Who worked on a pull request. A contributor is a person when the work ran in
 * their own workspace, and the project itself when it ran in a shared one.
 */
type ContributorSummary =
  MappedPullRequestPayload["contributorsSummary"][number];

/**
 * One line of the table. A pull request row carries its number, title and
 * lifetime; a branch row is the same work before a pull request exists for it.
 */
interface PullRequestListRow {
  key: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  pullRequest: {
    number: number;
    title: string;
    htmlUrl: string;
    openedAtMs: number;
  } | null;
  sessionsCount: number;
  totalTokens: number;
  costUsd: number | null;
  nonBilledCostUsd: number | null;
  billedCostUsd: number | null;
  modelBreakdown: ModelUsage[];
  contributorsSummary: ContributorSummary[];
  /** Whether the organization's connection reaches this repository. */
  repositoryCovered: boolean;
}

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

/** The placeholder for a value a row does not have. */
const MISSING_VALUE = "—";

const refKeyOf = (ref: {
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
}) => `${ref.repositoryHost} ${ref.repositoryFullName} ${ref.prNumber}`;

/**
 * The current status of every pull request on the page, asked for as one read
 * and reused for a minute so a refresh or a second viewer costs nothing.
 */
function useLiveStatuses({
  projectId,
  rows,
}: {
  projectId: string;
  rows: PullRequestListRow[];
}) {
  const refs = useMemo(
    () =>
      rows
        .flatMap((row) =>
          row.pullRequest
            ? [
                {
                  repositoryHost: row.repositoryHost,
                  repositoryFullName: row.repositoryFullName,
                  prNumber: row.pullRequest.number,
                },
              ]
            : [],
        )
        .slice(0, MAX_LIVE_STATUS_REFS),
    [rows],
  );

  const query = api.github.pullRequestLiveStatus.useQuery(
    { projectId, refs },
    {
      enabled: refs.length > 0,
      staleTime: STATUS_STALE_TIME_MS,
      refetchOnWindowFocus: false,
    },
  );

  const byRef = useMemo(() => {
    const map = new Map<string, LiveStatus>();
    for (const status of query.data?.statuses ?? []) {
      map.set(refKeyOf(status), {
        status: status.status,
        source: status.source,
        mappedAt: status.mappedAt,
      });
    }
    return map;
  }, [query.data]);

  return { byRef, isLoading: query.isLoading };
}

export function PullRequestsTable({ projectId }: { projectId: string }) {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const canManageOrganization = hasPermission("organization:manage");

  const usageQuery = api.codingAgents.pullRequestUsage.useQuery(
    { projectId },
    { refetchOnWindowFocus: false },
  );
  const rows = useMemo<PullRequestListRow[]>(
    () => toListRows(usageQuery.data),
    [usageQuery.data],
  );

  if (usageQuery.isLoading) {
    return <Skeleton height="180px" borderRadius="md" />;
  }

  if (usageQuery.isError) {
    return (
      <Text fontSize="sm" color="fg.error">
        Couldn&apos;t load pull requests
      </Text>
    );
  }

  const connection = usageQuery.data?.connection;
  if (!connection?.connected) {
    return (
      <NotConnectedState
        installUrl={connection?.installUrl ?? null}
        canManageOrganization={canManageOrganization}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <NoDataInfoBlock
        title="No pull requests yet"
        icon={<GitPullRequest />}
        description="Pull requests show up here once your coding agent runs on a branch that has one."
      />
    );
  }

  return (
    <ListedPullRequests
      projectId={projectId}
      rows={rows}
      installUrl={connection.installUrl}
      canManageOrganization={canManageOrganization}
    />
  );
}

/** The rows themselves, one page at a time, once there are rows to show. */
const ListedPullRequests: React.FC<{
  projectId: string;
  rows: PullRequestListRow[];
  installUrl: string | null;
  canManageOrganization: boolean;
}> = ({ projectId, rows, installUrl, canManageOrganization }) => {
  const { openDrawer } = useDrawer();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // A refetch can leave fewer rows than the page the reader is already on, and
  // the pager clamps only what it prints. Slicing on the stored page would
  // empty the table under a footer reading "Page 1 of 1", so the slice, the
  // pager and the next click all work off the clamped page.
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize],
  );
  const statuses = useLiveStatuses({ projectId, rows: visibleRows });
  const { tokenStats, costStats } = usePageStats(visibleRows);

  return (
    <VStack align="stretch" gap={3} width="full">
      <ListTable size="sm">
        <TableHeaderRow />
        <Table.Body>
          {visibleRows.map((row) => (
            <PullRequestRow
              key={row.key}
              row={row}
              status={
                row.pullRequest
                  ? statuses.byRef.get(statusKeyOf(row))
                  : undefined
              }
              isStatusLoading={statuses.isLoading}
              installUrl={installUrl}
              canManageOrganization={canManageOrganization}
              tokenStats={tokenStats}
              costStats={costStats}
              onOpenDetail={detailOpenerFor({ row, projectId, openDrawer })}
            />
          ))}
        </Table.Body>
      </ListTable>
      <Pagination
        page={currentPage}
        pageSize={pageSize}
        totalCount={rows.length}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        unitLabel="pull requests"
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </VStack>
  );
};

/**
 * Where each numeric column's values sit, measured against the page the reader
 * is looking at, and each column against its own values: a pull request can be
 * heavy on tokens and cheap in money, or the reverse, so one shared scale
 * would misread both.
 */
function usePageStats(rows: PullRequestListRow[]) {
  const tokenStats = useMemo(
    () => percentileStats(rows.map((row) => row.totalTokens)),
    [rows],
  );
  const costStats = useMemo(
    () => percentileStats(rows.map((row) => row.costUsd ?? 0)),
    [rows],
  );
  return { tokenStats, costStats };
}

/** What clicking a row does. A branch with no pull request opens nothing. */
function detailOpenerFor({
  row,
  projectId,
  openDrawer,
}: {
  row: PullRequestListRow;
  projectId: string;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
}): (() => void) | undefined {
  const pullRequest = row.pullRequest;
  if (!pullRequest) return undefined;
  return () =>
    openDrawer("pullRequestDetail", {
      projectId,
      repositoryHost: row.repositoryHost,
      repositoryFullName: row.repositoryFullName,
      prNumber: pullRequest.number,
    });
}

/** The status map key for a row that has a pull request. */
function statusKeyOf(row: PullRequestListRow): string {
  return refKeyOf({
    repositoryHost: row.repositoryHost,
    repositoryFullName: row.repositoryFullName,
    prNumber: row.pullRequest?.number ?? 0,
  });
}

const TableHeaderRow: React.FC = () => (
  <Table.Header>
    <Table.Row>
      <Table.ColumnHeader>Pull request</Table.ColumnHeader>
      <Table.ColumnHeader>Title</Table.ColumnHeader>
      <Table.ColumnHeader>Status</Table.ColumnHeader>
      <Table.ColumnHeader>Opened</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">Sessions</Table.ColumnHeader>
      <Table.ColumnHeader>Models</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">Tokens</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">Token cost</Table.ColumnHeader>
      <Table.ColumnHeader width={12} />
    </Table.Row>
  </Table.Header>
);

const NotConnectedState: React.FC<{
  installUrl: string | null;
  canManageOrganization: boolean;
}> = ({ installUrl, canManageOrganization }) => (
  <NoDataInfoBlock
    title="GitHub is not connected"
    icon={<GitPullRequest />}
    description={
      canManageOrganization
        ? "Connect GitHub so your sessions line up with the pull requests they went into."
        : "Ask an administrator to connect GitHub, then your sessions will line up with the pull requests they went into."
    }
  >
    {canManageOrganization && installUrl ? (
      <Button asChild size="sm">
        <a href={installUrl}>Connect GitHub</a>
      </Button>
    ) : null}
  </NoDataInfoBlock>
);

const PullRequestRow: React.FC<{
  row: PullRequestListRow;
  status: LiveStatus | undefined;
  isStatusLoading: boolean;
  installUrl: string | null;
  canManageOrganization: boolean;
  tokenStats: { p95: number; hasStats: boolean };
  costStats: { p95: number; hasStats: boolean };
  onOpenDetail: (() => void) | undefined;
}> = ({
  row,
  status,
  isStatusLoading,
  installUrl,
  canManageOrganization,
  tokenStats,
  costStats,
  onOpenDetail,
}) => (
  <Table.Row
    onClick={onOpenDetail}
    cursor={onOpenDetail ? "pointer" : undefined}
    _hover={onOpenDetail ? { bg: "bg.subtle" } : undefined}
  >
    <Table.Cell>
      {row.pullRequest ? (
        // The row opens the detail; this link leaves for GitHub, so it stops
        // the click from reaching the row underneath it.
        <Link
          href={row.pullRequest.htmlUrl}
          isExternal
          color="fg.muted"
          fontFamily="mono"
          fontSize="sm"
          onClick={(event) => event.stopPropagation()}
        >
          #{row.pullRequest.number}
        </Link>
      ) : (
        <Text fontSize="sm" color="fg.subtle">
          {MISSING_VALUE}
        </Text>
      )}
    </Table.Cell>
    <Table.Cell maxWidth="360px">
      {row.pullRequest ? (
        <>
          <Text fontSize="sm" fontWeight="medium" truncate>
            {row.pullRequest.title || row.headBranch}
          </Text>
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono" truncate>
            {row.repositoryFullName}
          </Text>
        </>
      ) : (
        <>
          <Text fontSize="sm" fontFamily="mono" truncate>
            {row.headBranch}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            No pull request yet
          </Text>
          <Text fontSize="xs" color="fg.subtle" fontFamily="mono" truncate>
            {row.repositoryFullName}
          </Text>
        </>
      )}
    </Table.Cell>
    <Table.Cell>
      <StatusChip
        status={status}
        isLoading={isStatusLoading && row.pullRequest !== null}
      />
    </Table.Cell>
    <Table.Cell fontSize="sm" color="fg.muted" whiteSpace="nowrap">
      {row.pullRequest
        ? formatShortDate({ timestampMs: row.pullRequest.openedAtMs })
        : MISSING_VALUE}
    </Table.Cell>
    <Table.Cell textAlign="end" fontSize="sm">
      <SessionsCell row={row} />
    </Table.Cell>
    <Table.Cell maxWidth="160px">
      <ModelsCell models={row.modelBreakdown} />
    </Table.Cell>
    <Table.Cell textAlign="end">
      <PeerComparisonCell
        value={row.totalTokens}
        p95={tokenStats.p95}
        hasStats={tokenStats.hasStats}
        formatValue={formatTokens}
        metricPhrase="total tokens"
      />
    </Table.Cell>
    <Table.Cell textAlign="end">
      <TokenCostCell row={row} stats={costStats} />
    </Table.Cell>
    <Table.Cell>
      <RowActionsMenu
        row={row}
        installUrl={installUrl}
        canManageOrganization={canManageOrganization}
        onOpenDetail={onOpenDetail}
      />
    </Table.Cell>
  </Table.Row>
);

/** The session count, with who ran them behind a hover. */
const SessionsCell: React.FC<{ row: PullRequestListRow }> = ({ row }) => {
  const count = numeral(row.sessionsCount).format("0,0");
  if (row.contributorsSummary.length === 0) return <>{count}</>;
  return (
    <Tooltip
      content={
        <VStack align="start" gap={0.5} maxWidth="full">
          {row.contributorsSummary.map((contributor) => (
            <Text key={contributor.projectId}>
              {contributor.contributorLabel}: {contributor.sessionsCount}{" "}
              {contributor.sessionsCount === 1 ? "session" : "sessions"}
            </Text>
          ))}
        </VStack>
      }
      positioning={{ placement: "left" }}
    >
      {/* Who ran the sessions is written down nowhere else on this row, so the
          hover has a tab stop behind it. */}
      <Text as="span" cursor="help" tabIndex={0}>
        {count}
      </Text>
    </Tooltip>
  );
};

/** The leading model, and how many others rode along. */
const ModelsCell: React.FC<{ models: ModelUsage[] }> = ({ models }) => {
  if (models.length === 0) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        {MISSING_VALUE}
      </Text>
    );
  }
  const [primary, ...rest] = models;
  return (
    <Tooltip
      content={
        <VStack align="start" gap={0.5}>
          {models.map((model) => (
            <Text key={model.model}>
              {model.model}: {formatTokens(model.totalTokens)} tokens
              {model.costUsd === null ? "" : `, ${formatCost(model.costUsd)}`}
            </Text>
          ))}
        </VStack>
      }
      positioning={{ placement: "left" }}
    >
      <Text fontSize="xs" color="fg.muted" cursor="help" truncate tabIndex={0}>
        {primary!.model}
        {rest.length > 0 ? ` +${rest.length}` : ""}
      </Text>
    </Tooltip>
  );
};

/**
 * The list-price cost of the row, read exactly like every other number here:
 * one value, one comparison bar. Money a bundled plan already covered is still
 * that same list price, so it is explained on hover rather than set apart by a
 * color the reader would have to learn.
 */
const TokenCostCell: React.FC<{
  row: PullRequestListRow;
  stats: { p95: number; hasStats: boolean };
}> = ({ row, stats }) => {
  if (row.costUsd === null) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        {MISSING_VALUE}
      </Text>
    );
  }

  const nonBilled = row.nonBilledCostUsd ?? 0;
  const isBundled = nonBilled > 0;
  const sentence = peerComparisonSentence({
    value: row.costUsd,
    p95: stats.p95,
    hasStats: stats.hasStats,
    formatValue: (value) => formatCost(value),
    metricPhrase: "in token cost",
  });

  return (
    <PeerComparisonCell
      value={row.costUsd}
      p95={stats.p95}
      hasStats={stats.hasStats}
      formatValue={(value) => formatCost(value)}
      metricPhrase="in token cost"
      tooltipContent={
        isBundled ? (
          <VStack align="stretch" gap={2}>
            <CostBreakdownTooltipContent
              isBundled
              billedCost={row.billedCostUsd ?? 0}
              nonBilledCost={nonBilled}
              grandCost={row.costUsd}
            />
            {sentence ? <Text textStyle="2xs">{sentence}</Text> : null}
          </VStack>
        ) : undefined
      }
    />
  );
};

/**
 * The pull request's current state. A snapshot answer is drawn back so it never
 * passes for a live one, and says in its tooltip how old it is.
 */
const StatusChip: React.FC<{
  status: LiveStatus | undefined;
  isLoading: boolean;
}> = ({ status, isLoading }) => {
  if (isLoading) return <Skeleton height="20px" width="64px" />;
  if (!status) {
    return (
      <Text fontSize="sm" color="fg.subtle">
        {MISSING_VALUE}
      </Text>
    );
  }

  const label = STATUS_LABELS[status.status];
  if (status.source === "live") {
    return (
      <Badge
        size="sm"
        colorPalette={STATUS_PALETTES[status.status]}
        data-status-source="live"
      >
        {label}
      </Badge>
    );
  }

  const asOf = status.mappedAt
    ? new Date(status.mappedAt).toLocaleDateString()
    : null;
  return (
    <Tooltip
      content={
        asOf
          ? `Last known status, from ${asOf}. GitHub is not answering right now.`
          : "Last known status. GitHub is not answering right now."
      }
    >
      <Badge
        size="sm"
        variant="outline"
        colorPalette="gray"
        color="fg.subtle"
        data-status-source="snapshot"
        // How stale the answer is only exists in the hover, so it gets a tab
        // stop too.
        tabIndex={0}
      >
        {label}
      </Badge>
    </Tooltip>
  );
};

const RowActionsMenu: React.FC<{
  row: PullRequestListRow;
  installUrl: string | null;
  canManageOrganization: boolean;
  onOpenDetail: (() => void) | undefined;
}> = ({ row, installUrl, canManageOrganization, onOpenDetail }) => {
  const githubUrl =
    row.pullRequest?.htmlUrl ??
    `https://${row.repositoryHost}/${row.repositoryFullName}/tree/${row.headBranch}`;
  const canOfferLinking = !row.repositoryCovered && installUrl !== null;

  return (
    // The row itself opens the detail, so every control inside it has to stop
    // the click from reaching the row, or opening a menu would open a drawer
    // behind it.
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="presentation"
    >
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Actions for ${
              row.pullRequest
                ? `pull request ${row.pullRequest.number}`
                : row.headBranch
            }`}
          >
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          {onOpenDetail ? (
            <Menu.Item value="details" onClick={onOpenDetail}>
              View details
            </Menu.Item>
          ) : null}
          <Menu.Item value="open" asChild>
            <a href={githubUrl} target="_blank" rel="noopener noreferrer">
              Open on GitHub
            </a>
          </Menu.Item>
          {canOfferLinking &&
            (canManageOrganization ? (
              <Menu.Item value="link" asChild>
                <a href={installUrl}>Link this repository</a>
              </Menu.Item>
            ) : (
              <Tooltip
                content="Ask an administrator to link this repository."
                positioning={{ placement: "left" }}
                showArrow
              >
                <Menu.Item
                  value="link"
                  disabled
                  opacity={0.5}
                  cursor="not-allowed"
                >
                  Link this repository
                </Menu.Item>
              </Tooltip>
            ))}
        </Menu.Content>
      </Menu.Root>
    </div>
  );
};

function toMappedListRow(row: MappedPullRequestPayload): PullRequestListRow {
  return {
    key: `pull-request ${row.repositoryHost} ${row.repositoryFullName} ${row.prNumber}`,
    repositoryHost: row.repositoryHost,
    repositoryFullName: row.repositoryFullName,
    headBranch: row.headBranch,
    pullRequest: {
      number: row.prNumber,
      title: row.title,
      htmlUrl: row.htmlUrl,
      openedAtMs: row.prCreatedAtMs,
    },
    sessionsCount: row.sessionsCount,
    totalTokens: row.totalTokens,
    costUsd: row.costUsd,
    billedCostUsd: row.billedCostUsd,
    nonBilledCostUsd: row.nonBilledCostUsd,
    modelBreakdown: row.modelBreakdown,
    contributorsSummary: row.contributorsSummary,
    // A mapped pull request came through the connection, so the repository it
    // lives in is covered by definition.
    repositoryCovered: true,
  };
}

function toBranchListRow(row: UnlinkedBranchPayload): PullRequestListRow {
  return {
    key: `branch ${row.repositoryHost} ${row.repositoryFullName} ${row.headBranch}`,
    repositoryHost: row.repositoryHost,
    repositoryFullName: row.repositoryFullName,
    headBranch: row.headBranch,
    pullRequest: null,
    sessionsCount: row.sessionsCount,
    totalTokens: row.totalTokens,
    costUsd: row.costUsd,
    billedCostUsd: row.billedCostUsd,
    nonBilledCostUsd: row.nonBilledCostUsd,
    modelBreakdown: [],
    contributorsSummary: [],
    repositoryCovered: row.repoCovered,
  };
}

/**
 * Flatten the read into one ordered list: mapped pull requests newest first,
 * then the branches still waiting for one.
 */
function toListRows(data: UsagePayload | undefined): PullRequestListRow[] {
  if (!data) return [];

  return [
    ...[...data.rows]
      .sort((a, b) => b.prCreatedAtMs - a.prCreatedAtMs)
      .map(toMappedListRow),
    ...[...data.unlinked]
      .sort((a, b) => b.sessionsCount - a.sessionsCount)
      .map(toBranchListRow),
  ];
}
