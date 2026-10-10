import { BackLink } from "@langwatch/design-system/back-link";
import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Box,
  Button,
  Card,
  HStack,
  Spinner,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { getHexColorForString } from "@langwatch/design-system/rotating-colors";
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

/**
 * Real <button> for keyboard nav + screen-reader announcement (Ariana QA
 * finding G13 — sort chips were unfocusable divs). Avoids Chakra v3's
 * polymorphic Box `as="button"` typing pitfall while staying token-driven.
 */
function SortChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "subtle" : "outline"}
      colorPalette={active ? "accent" : "gray"}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </Button>
  );
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
      <HStack gap={2}>
        <Text fontSize="sm" color="fg.muted" id="sort-by-label">
          Sort by:
        </Text>
        <SortChips value={sortBy} onChange={onSortChange} ariaLabelledBy="sort-by-label" />
      </HStack>

      {teamsQuery.error ? (
        <HandledErrorAlert error={teamsQuery.error} fallbackTitle="Couldn't load team activity" />
      ) : null}

      <Card.Root variant="showcase">
        {isLoading && (
          <Box padding={6}>
            <Spinner />
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
          <ListTable size="sm" containerProps={{ overflowX: "auto" }}>
            <Header />
            <Table.Body>
              {teams.map((team) => (
                <Row key={team.teamId ?? "org-wide"} team={team} />
              ))}
            </Table.Body>
          </ListTable>
        )}
      </Card.Root>
      <Text fontSize="xs" color="fg.muted">
        {teams.length} team{teams.length === 1 ? "" : "s"} shown.
      </Text>
    </>
  );
}

function SortChips({
  value,
  onChange,
  ariaLabelledBy,
}: {
  value: SortField;
  onChange: (v: SortField) => void;
  ariaLabelledBy?: string;
}) {
  const opts: { key: SortField; label: string }[] = [
    { key: "spend", label: "Spend" },
    { key: "requests", label: "Requests" },
    { key: "lastActivity", label: "Last active" },
  ];
  return (
    <HStack as="fieldset" gap={1} aria-labelledby={ariaLabelledBy}>
      {opts.map((o) => (
        <SortChip
          key={o.key}
          label={o.label}
          active={o.key === value}
          onClick={() => onChange(o.key)}
        />
      ))}
    </HStack>
  );
}

function Header() {
  return (
    <Table.Header>
      <Table.Row>
        {["Team", "Spend", "Requests", "Last active", "Trend", "Sources"].map((label) => (
          <Table.ColumnHeader key={label} whiteSpace="nowrap">
            {label}
          </Table.ColumnHeader>
        ))}
      </Table.Row>
    </Table.Header>
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
    <Table.Row>
      <Table.Cell>
        {isOrgWide ? name : <Link href={`/governance/teams/${team.teamId}`}>{name}</Link>}
      </Table.Cell>
      <Table.Cell whiteSpace="nowrap">{fmtUsd(team.spendUsd)}</Table.Cell>
      <Table.Cell>{numeral(team.requestCount).format("0,0")}</Table.Cell>
      <Table.Cell whiteSpace="nowrap" color="fg.muted">
        {fmtRelative(team.lastActivityIso)}
      </Table.Cell>
      <Table.Cell whiteSpace="nowrap" color={trendColor}>
        {team.hasPriorBaseline ? `${arrow} ${fmtTrendPct(team.deltaPctVsPriorWindow)}` : "—"}
      </Table.Cell>
      <Table.Cell whiteSpace="nowrap" color="fg.muted">
        {team.sourceCount} {team.sourceCount === 1 ? "source" : "sources"}
      </Table.Cell>
    </Table.Row>
  );
}

export default withGovernanceSection(GovernanceTeamsListPage);
