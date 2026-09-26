import { Box, Heading, HStack, SimpleGrid, Spinner, Text, VStack } from "@chakra-ui/react";
import { getHexColorForString } from "@langwatch/design-system/rotating-colors";
import { type TimeInput, nowInstant, toEpochMs } from "@langwatch/time";
import numeral from "numeral";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceRouter } from "../../../behavior/governance-router.ts";
import { useGovernanceScope } from "../../../behavior/governance-session.ts";
import { Link } from "../../../ui/elements/governance-link.tsx";
import { HandledErrorAlert } from "../../../ui/elements/handled-error-alert.tsx";
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
  // Resolve the team's first project slug for the bird's-eye drill-in link,
  // landing on the team's workspace via the existing project-shell. No
  // "viewing as admin" banner: that keys off a PERSONAL workspace owned by
  // someone else, and an org team isn't one, so this drill-through is silent.
  const teamProjectSlug =
    organizations?.flatMap((org) => org.teams ?? []).find((t) => t.id === teamId)?.projects?.[0]
      ?.slug ?? null;

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
      <VStack align="stretch" gap={4} width="full" maxW="container.xl">
        <VStack align="start" gap={1}>
          <Text fontSize="xs" color="fg.muted">
            <Link href="/governance" color="blue.600">
              ← AI Governance
            </Link>{" "}
            ·{" "}
            <Link href="/governance/teams" color="blue.600">
              All teams
            </Link>
          </Text>
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
            <Heading size="md">{team?.teamName ?? "Team not found"}</Heading>
          </HStack>
        </VStack>

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
          <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={5}>
            <Text fontSize="sm" color="fg.muted">
              No spend data for this team in the last 30 days. The team may not have any associated
              ingestion sources reporting activity yet.
            </Text>
          </Box>
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

            <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={4}>
              <Text fontSize="sm" fontWeight="medium" marginBottom={1}>
                Detail metrics
              </Text>
              <Text fontSize="xs" color="fg.muted" marginBottom={3}>
                Per-day spend, per-user breakdown and model mix for this team are not available yet.
              </Text>
              {teamProjectSlug && (
                <>
                  <Link
                    href={`/${teamProjectSlug}/traces`}
                    color="blue.600"
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
              <Link href="/governance" color="blue.600" fontSize="sm" fontWeight="medium">
                See this team in the bird's-eye chart →
              </Link>
              <Text fontSize="xs" color="fg.subtle" marginTop={1}>
                The chart's {`'By team'`} view shows this team's spend next to every other team's.
              </Text>
            </Box>
          </>
        )}
      </VStack>
    </GovernanceLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={3}>
      <Text
        fontSize="xs"
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wider"
      >
        {label}
      </Text>
      <Heading as="span" size="sm" marginTop={1}>
        {value}
      </Heading>
    </Box>
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
