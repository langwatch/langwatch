import { BackLink } from "@langwatch/design-system/back-link";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Box,
  Card,
  HStack,
  SimpleGrid,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { getHexColorForString } from "@langwatch/design-system/rotating-colors";
import { StatTile, StatTileFigure } from "@langwatch/design-system/stat-tile";
import { HandledErrorAlert } from "@langwatch/error-views";
import { findLandingProjects } from "@langwatch/project-contract";
import { type TimeInput, nowInstant, toEpochMs } from "@langwatch/time";
import { Users } from "lucide-react";
import numeral from "numeral";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceRouter } from "../../../behavior/governance-router.ts";
import { useGovernanceScope } from "../../../behavior/governance-session.ts";
import { Link } from "../../../ui/elements/governance-link.tsx";
import { PermissionRequiredNotice } from "../../../ui/elements/permission-required-notice.tsx";
import GovernanceLayout from "../../../ui/sections/governance-layout.tsx";
import { withGovernanceSection } from "../../../ui/sections/governance-section-gate.tsx";
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

/**
 * Per-team governance detail from spendByTeam rollup. Headline metrics + traces link.
 * Detail data deferred. Every control navigates; copy marks rest unavailable.
 */
function GovernanceTeamDetailPage() {
  const router = useGovernanceRouter();
  const teamId = typeof router.query.id === "string" ? router.query.id : null;
  const { organization, organizations, hasAnyPermission } = useGovernanceScope();
  const orgId = organization?.id ?? "";
  const canReadActivity = hasAnyPermission("activityMonitor:view");
  // The team's landing project for the drill-in link: never an aggregate, the
  // rule the app lands on (ADR-144 block F). No "viewing as admin" banner: that
  // keys off someone else's PERSONAL workspace, so this drill-through is silent.
  const teamProjects =
    organizations?.flatMap((org) => org.teams ?? []).find((t) => t.id === teamId)?.projects ?? [];
  const teamProjectSlug = findLandingProjects(teamProjects)[0]?.slug ?? null;

  const teamsQuery = api.activityMonitor.spendByTeam.useQuery(
    { organizationId: orgId, windowDays: 30, limit: 500 },
    { enabled: !!orgId && canReadActivity, refetchOnWindowFocus: false },
  );

  const team = (teamsQuery.data ?? []).find((t) => t.teamId === teamId);
  const pageTitle = team
    ? `${team.teamName} · AI Governance · LangWatch`
    : "Team · AI Governance · LangWatch";
  const activityView = teamActivityView({
    canReadActivity,
    hasError: !!teamsQuery.error,
    isLoading: teamsQuery.isLoading,
    hasTeam: !!team,
  });

  return (
    <GovernanceLayout pageTitle={pageTitle}>
      <PageLayout.Header>
        <BackLink href="/governance/teams" onNavigate={(href) => router.push(href)}>
          All teams
        </BackLink>
        <HStack gap={2}>
          <Box
            width="14px"
            height="14px"
            borderRadius="full"
            // A swatch with no team behind it is an empty surface, not text,
            // so it takes a surface token. `fg.muted` here painted a 14px
            // circle in reading ink.
            backgroundColor={team ? getHexColorForString(team.teamName) : "bg.emphasized"}
          />
          <PageLayout.Heading>{team?.teamName ?? "Team not found"}</PageLayout.Heading>
        </HStack>
      </PageLayout.Header>

      <PageLayout.Container>
        <VStack align="stretch" gap={6} width="full">
          {activityView === "forbidden" && (
            <PermissionRequiredNotice
              permission="activityMonitor:view"
              detail="This team's spend and activity stay hidden until then."
            />
          )}
          {activityView === "error" && teamsQuery.error && (
            <HandledErrorAlert
              error={teamsQuery.error}
              fallbackTitle="Couldn't load this team's activity"
            />
          )}
          {activityView === "loading" && <Spinner />}
          {activityView === "missing" && (
            <Card.Root variant="showcase" padding={5}>
              <NoDataInfoBlock
                icon={<Users />}
                title="No spend data for this team in the last 30 days"
                description="The team may not have any associated ingestion sources reporting activity yet."
              />
            </Card.Root>
          )}
          {activityView === "ready" && team && (
            <>
              <SimpleGrid columns={{ base: 1, md: 4 }} gap={3}>
                <Stat label="Spend (30 d)" value={fmtUsd(team.spendUsd)} />
                <Stat label="Requests" value={numeral(team.requestCount).format("0,0")} />
                <Stat label="Last active" value={fmtRelative(team.lastActivityIso)} />
                <Stat
                  label="Sources"
                  value={`${team.sourceCount} ${team.sourceCount === 1 ? "source" : "sources"}`}
                />
              </SimpleGrid>

              <Card.Root variant="showcase" padding={4}>
                <Text fontSize="sm" fontWeight="medium" marginBottom={1}>
                  Detail metrics
                </Text>
                <Text fontSize="xs" color="fg.muted" marginBottom={3}>
                  Per-day spend, per-user breakdown and model mix for this team are not available
                  yet.
                </Text>
                {teamProjectSlug && (
                  <>
                    <Link
                      href={`/${teamProjectSlug}/traces`}
                      color="accent.fg"
                      fontSize="sm"
                      fontWeight="medium"
                    >
                      View this team's workspace traces →
                    </Link>
                    <Text fontSize="xs" color="fg.subtle" marginTop={1} marginBottom={3}>
                      The trace explorer opens with this team's data.
                    </Text>
                  </>
                )}
                <Link href="/governance" color="accent.fg" fontSize="sm" fontWeight="medium">
                  See this team in the bird's-eye chart →
                </Link>
                <Text fontSize="xs" color="fg.subtle" marginTop={1}>
                  The chart's {`'By team'`} view shows this team's spend next to every other team's.
                </Text>
              </Card.Root>
            </>
          )}
        </VStack>
      </PageLayout.Container>
    </GovernanceLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <StatTile variant="showcase" label={label}>
      <StatTileFigure>{value}</StatTileFigure>
    </StatTile>
  );
}

export default withGovernanceSection(GovernanceTeamDetailPage);

function teamActivityView({
  canReadActivity,
  hasError,
  isLoading,
  hasTeam,
}: {
  canReadActivity: boolean;
  hasError: boolean;
  isLoading: boolean;
  hasTeam: boolean;
}): "forbidden" | "error" | "loading" | "missing" | "ready" {
  if (!canReadActivity) return "forbidden";
  if (hasError) return "error";
  if (isLoading) return "loading";
  return hasTeam ? "ready" : "missing";
}
