import { BackLink } from "@langwatch/design-system/back-link";
import { Card } from "@langwatch/design-system/card";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { getHexColorForString } from "@langwatch/design-system/rotating-colors";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { HandledErrorAlert } from "@langwatch/error-views";
import { type TimeInput, nowInstant, toEpochMs } from "@langwatch/time";
import { Users } from "lucide-react";
import numeral from "numeral";

import { api, type RouterOutputs } from "../../../behavior/governance-api.ts";
import { useGovernanceRouter } from "../../../behavior/governance-router.ts";
import { useGovernanceScope } from "../../../behavior/governance-session.ts";
import { Link } from "../../../ui/elements/governance-link.tsx";
import { PermissionRequiredNotice } from "../../../ui/elements/permission-required-notice.tsx";
import GovernanceLayout from "../../../ui/sections/governance-layout.tsx";
import { withGovernanceSection } from "../../../ui/sections/governance-section-gate.tsx";
type SpendByTeam = RouterOutputs["activityMonitor"]["spendByTeam"][number];
type SortField = "spend" | "requests" | "lastActivity";

const SORT_LABEL: Record<SortField, string> = {
  spend: "spend",
  requests: "requests",
  lastActivity: "last activity",
};

function isSortField(v: string | string[] | undefined): v is SortField {
  return v === "spend" || v === "requests" || v === "lastActivity";
}

const fmtUsd = (n: number | string) => {
  const v = typeof n === "string" ? Number(n) : n;
  return v === 0 ? "$0.00" : numeral(v).format("$0,0.00");
};

const fmtRelative = (date: TimeInput | null): string => {
  if (!date) return "—";
  const epochMs = toEpochMs(date);
  if (Number.isNaN(epochMs)) return "—";
  const diffMs = nowInstant().epochMilliseconds - epochMs;
  if (diffMs < 0) return "just now";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
};

function fmtTrendPct(pct: number): string {
  const abs = Math.abs(pct);
  if (abs >= 1000) return ">1000%";
  if (abs < 1) return "0%";
  return `${Math.round(abs)}%`;
}

function GovernanceTeamsListPage() {
  const router = useGovernanceRouter();
  const { organization, hasAnyPermission } = useGovernanceScope();
  const orgId = organization?.id ?? "";
  const canReadActivity = hasAnyPermission("activityMonitor:view");

  // Sort state lives in URL (`?sort=requests`) so the view is deep-linkable
  // and stable across refresh / share-this-view. `spend` is the canonical
  // default; URL is omitted in that case to keep the bare path clean.
  const sortBy: SortField = isSortField(router.query.sort) ? router.query.sort : "spend";
  const setSortBy = (next: SortField) => {
    const params = new URLSearchParams();
    if (next !== "spend") params.set("sort", next);
    router.replace(params.toString() ? `?${params.toString()}` : "?");
  };

  return (
    <GovernanceLayout pageTitle="Teams · AI Governance · LangWatch">
      <PageLayout.Header>
        <BackLink href="/governance" onNavigate={(href) => router.push(href)}>
          AI Governance
        </BackLink>
        <PageLayout.Heading>All teams by {SORT_LABEL[sortBy]}</PageLayout.Heading>
      </PageLayout.Header>

      <PageLayout.Container>
        <VStack align="stretch" gap={6} width="full">
          <Text color="fg.muted" fontSize="sm">
            Every team that reported activity in the last 30 days. Click a row to drill into a
            single team.
          </Text>

          {canReadActivity ? (
            <TeamSpendPanel orgId={orgId} sortBy={sortBy} onSortChange={setSortBy} />
          ) : (
            <PermissionRequiredNotice
              permission="activityMonitor:view"
              detail="Team spend and activity stay hidden until then."
            />
          )}
        </VStack>
      </PageLayout.Container>
    </GovernanceLayout>
  );
}

/**
 * Mounted only for a viewer holding `activityMonitor:view`, which is the grant
 * `spendByTeam` asks for.
 */
function TeamSpendPanel({
  orgId,
  sortBy,
  onSortChange,
}: {
  orgId: string;
  sortBy: SortField;
  onSortChange: (next: SortField) => void;
}) {
  const teamsQuery = api.activityMonitor.spendByTeam.useQuery(
    {
      organizationId: orgId,
      windowDays: 30,
      limit: 500,
      sortBy,
      sortDir: "desc",
    },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const teams = teamsQuery.data ?? [];
  const isLoading = teamsQuery.isLoading;
  const isEmpty = !isLoading && teams.length === 0;
  const hasRows = !isLoading && teams.length > 0;

  return (
    <>
      {teamsQuery.error ? (
        <HandledErrorAlert error={teamsQuery.error} fallbackTitle="Couldn't load team activity" />
      ) : null}

      <Card variant="showcase" padding="none" bodyLayout="stack">
        {isLoading && (
          <Box padding={6}>
            <SkeletonRows rows={4} label="Loading teams" />
          </Box>
        )}
        {isEmpty && (
          <NoDataInfoBlock
            icon={<Users />}
            title={
              teamsQuery.error
                ? "Team activity could not be read."
                : "No team activity this window."
            }
            description="Team spend and requests appear here once connected sources report activity."
          />
        )}
        {hasRows && (
          <ListTable variant="embedded" scroll="x" scrollLabel="Teams">
            <Header sortBy={sortBy} onSortChange={onSortChange} />
            <ListTable.Body>
              {teams.map((team) => (
                <Row key={team.teamId ?? "org-wide"} team={team} />
              ))}
            </ListTable.Body>
          </ListTable>
        )}
      </Card>
      <Text fontSize="xs" color="fg.muted">
        {teams.length} team{teams.length === 1 ? "" : "s"} shown.
      </Text>
    </>
  );
}

/** The server ranks high to low by the chosen column; a header click picks the column. */
function Header({
  sortBy,
  onSortChange,
}: {
  sortBy: SortField;
  onSortChange: (next: SortField) => void;
}) {
  const sorted = (field: SortField) => (sortBy === field ? "desc" : false);
  return (
    <ListTable.Header>
      <ListTable.Row>
        <ListTable.ColumnHeader>Team</ListTable.ColumnHeader>
        <ListTable.SortHeader sorted={sorted("spend")} onSort={() => onSortChange("spend")}>
          Spend
        </ListTable.SortHeader>
        <ListTable.SortHeader sorted={sorted("requests")} onSort={() => onSortChange("requests")}>
          Requests
        </ListTable.SortHeader>
        <ListTable.SortHeader
          sorted={sorted("lastActivity")}
          onSort={() => onSortChange("lastActivity")}
        >
          Last active
        </ListTable.SortHeader>
        <ListTable.ColumnHeader>Trend</ListTable.ColumnHeader>
        <ListTable.ColumnHeader>Sources</ListTable.ColumnHeader>
      </ListTable.Row>
    </ListTable.Header>
  );
}

function trendArrow(pct: number): string {
  if (pct > 0) return "↑";
  if (pct < 0) return "↓";
  return "·";
}

function trendColorFor({
  hasPriorBaseline,
  pct,
}: {
  hasPriorBaseline: boolean;
  pct: number;
}): string {
  if (!hasPriorBaseline) return "fg.muted";
  if (pct > 25) return "fg.warning";
  if (pct < -25) return "fg.info";
  return "fg.muted";
}

function Row({ team }: { team: SpendByTeam }) {
  const isOrgWide = !team.teamId;
  const dotColor = isOrgWide ? "fg.subtle" : getHexColorForString(team.teamName);
  const arrow = trendArrow(team.deltaPctVsPriorWindow);
  const trendColor = trendColorFor({
    hasPriorBaseline: team.hasPriorBaseline,
    pct: team.deltaPctVsPriorWindow,
  });
  const name = (
    <HStack gap={2}>
      <Box boxSize="10px" borderRadius="full" backgroundColor={dotColor} flexShrink={0} />
      <Text fontWeight="medium">{team.teamName}</Text>
    </HStack>
  );
  return (
    <ListTable.Row>
      <ListTable.Cell>
        {isOrgWide ? name : <Link href={`/governance/teams/${team.teamId}`}>{name}</Link>}
      </ListTable.Cell>
      <ListTable.Cell nowrap>{fmtUsd(team.spendUsd)}</ListTable.Cell>
      <ListTable.Cell>{numeral(team.requestCount).format("0,0")}</ListTable.Cell>
      <ListTable.Cell nowrap tone="muted">
        {fmtRelative(team.lastActivityIso)}
      </ListTable.Cell>
      <ListTable.Cell nowrap>
        <Text as="span" color={trendColor}>
          {team.hasPriorBaseline ? `${arrow} ${fmtTrendPct(team.deltaPctVsPriorWindow)}` : "—"}
        </Text>
      </ListTable.Cell>
      <ListTable.Cell nowrap tone="muted">
        {team.sourceCount} {team.sourceCount === 1 ? "source" : "sources"}
      </ListTable.Cell>
    </ListTable.Row>
  );
}

export default withGovernanceSection(GovernanceTeamsListPage);
