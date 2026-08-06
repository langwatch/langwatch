import { Badge, Button, Skeleton, Table, Text } from "@chakra-ui/react";
import { GitPullRequest, MoreVertical } from "lucide-react";
import numeral from "numeral";
import type React from "react";
import { useMemo } from "react";

import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { ListTable } from "~/components/ui/ListTable";
import { Link } from "~/components/ui/link";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * What each pull request cost in assistant usage.
 *
 * Every row covers the pull request's whole lifetime: the sessions that ran on
 * its branch before it was opened count toward it too, and nothing here is
 * scoped to a time window. Branches whose pull request has not been opened yet
 * are listed underneath rather than dropped, so the work still adds up.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

/**
 * Most pull requests one status read may ask about, matching the read's own
 * cap. Asking beyond it is refused, so the table reads status for its first
 * page of rows and leaves the rest unlabelled rather than failing the page.
 */
const MAX_LIVE_STATUS_REFS = 50;

/** How long a status answer is reused before the table asks again. */
const STATUS_STALE_TIME_MS = 60_000;

type PullRequestStatus = "open" | "draft" | "merged" | "closed";

interface LiveStatus {
  status: PullRequestStatus;
  source: "live" | "snapshot";
  mappedAt: Date | null;
}

/**
 * One line of the table. A pull request row carries its number and lifetime; a
 * branch row is the same work before a pull request exists for it.
 */
interface PullRequestListRow {
  key: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  pullRequest: {
    number: number;
    htmlUrl: string;
    openedAtMs: number;
  } | null;
  sessionsCount: number;
  totalTokens: number;
  costUsd: number | null;
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
  merged: "purple",
  closed: "red",
};

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
  const statuses = useLiveStatuses({ projectId, rows });

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
    <ListTable size="sm">
      <TableHeaderRow />
      <Table.Body>
        {rows.map((row) => (
          <PullRequestRow
            key={row.key}
            row={row}
            status={
              row.pullRequest ? statuses.byRef.get(statusKeyOf(row)) : undefined
            }
            isStatusLoading={statuses.isLoading}
            installUrl={connection.installUrl}
            canManageOrganization={canManageOrganization}
          />
        ))}
      </Table.Body>
    </ListTable>
  );
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
      <Table.ColumnHeader>Repository</Table.ColumnHeader>
      <Table.ColumnHeader>Status</Table.ColumnHeader>
      <Table.ColumnHeader>Opened</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">Sessions</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">Tokens</Table.ColumnHeader>
      <Table.ColumnHeader textAlign="end">Assistant cost</Table.ColumnHeader>
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
}> = ({ row, status, isStatusLoading, installUrl, canManageOrganization }) => (
  <Table.Row>
    <Table.Cell>
      {row.pullRequest ? (
        <Link href={row.pullRequest.htmlUrl} isExternal color="blue.fg">
          #{row.pullRequest.number}
        </Link>
      ) : (
        <Text fontSize="sm" color="fg.muted">
          No pull request yet
        </Text>
      )}
      <Text fontSize="xs" color="fg.subtle" fontFamily="mono" truncate>
        {row.headBranch}
      </Text>
    </Table.Cell>
    <Table.Cell fontFamily="mono" fontSize="xs">
      {row.repositoryFullName}
    </Table.Cell>
    <Table.Cell>
      <StatusChip
        status={status}
        isLoading={isStatusLoading && row.pullRequest !== null}
      />
    </Table.Cell>
    <Table.Cell fontSize="sm" color="fg.muted">
      {row.pullRequest
        ? new Date(row.pullRequest.openedAtMs).toLocaleDateString()
        : MISSING_VALUE}
    </Table.Cell>
    <Table.Cell textAlign="end" fontSize="sm">
      {numeral(row.sessionsCount).format("0,0")}
    </Table.Cell>
    <Table.Cell textAlign="end" fontSize="sm">
      {numeral(row.totalTokens).format("0,0")}
    </Table.Cell>
    <Table.Cell textAlign="end" fontSize="sm">
      {row.costUsd === null ? MISSING_VALUE : formatBudgetUsd(row.costUsd)}
    </Table.Cell>
    <Table.Cell>
      <RowActionsMenu
        row={row}
        installUrl={installUrl}
        canManageOrganization={canManageOrganization}
      />
    </Table.Cell>
  </Table.Row>
);

/** The placeholder for a value a row does not have. */
const MISSING_VALUE = "—";

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
}> = ({ row, installUrl, canManageOrganization }) => {
  const githubUrl =
    row.pullRequest?.htmlUrl ??
    `https://${row.repositoryHost}/${row.repositoryFullName}/tree/${row.headBranch}`;
  const offerLinking = !row.repositoryCovered && installUrl !== null;

  return (
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
        <Menu.Item value="open" asChild>
          <a href={githubUrl} target="_blank" rel="noopener noreferrer">
            Open on GitHub
          </a>
        </Menu.Item>
        {offerLinking &&
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
  );
};

/**
 * Flatten the read into one ordered list: mapped pull requests newest first,
 * then the branches still waiting for one.
 */
function toListRows(
  data:
    | {
        rows: Array<{
          repositoryHost: string;
          repositoryFullName: string;
          prNumber: number;
          headBranch: string;
          htmlUrl: string;
          prCreatedAtMs: number;
          sessionsCount: number;
          totalTokens: number;
          costUsd: number | null;
        }>;
        unlinked: Array<{
          repositoryHost: string;
          repositoryFullName: string;
          headBranch: string;
          sessionsCount: number;
          totalTokens: number;
          costUsd: number | null;
          repoCovered: boolean;
        }>;
      }
    | undefined,
): PullRequestListRow[] {
  if (!data) return [];

  const mapped = [...data.rows]
    .sort((a, b) => b.prCreatedAtMs - a.prCreatedAtMs)
    .map<PullRequestListRow>((row) => ({
      key: `pull-request ${row.repositoryHost} ${row.repositoryFullName} ${row.prNumber}`,
      repositoryHost: row.repositoryHost,
      repositoryFullName: row.repositoryFullName,
      headBranch: row.headBranch,
      pullRequest: {
        number: row.prNumber,
        htmlUrl: row.htmlUrl,
        openedAtMs: row.prCreatedAtMs,
      },
      sessionsCount: row.sessionsCount,
      totalTokens: row.totalTokens,
      costUsd: row.costUsd,
      // A mapped pull request came through the connection, so the repository
      // it lives in is covered by definition.
      repositoryCovered: true,
    }));

  const unlinked = [...data.unlinked]
    .sort((a, b) => b.sessionsCount - a.sessionsCount)
    .map<PullRequestListRow>((row) => ({
      key: `branch ${row.repositoryHost} ${row.repositoryFullName} ${row.headBranch}`,
      repositoryHost: row.repositoryHost,
      repositoryFullName: row.repositoryFullName,
      headBranch: row.headBranch,
      pullRequest: null,
      sessionsCount: row.sessionsCount,
      totalTokens: row.totalTokens,
      costUsd: row.costUsd,
      repositoryCovered: row.repoCovered,
    }));

  return [...mapped, ...unlinked];
}
