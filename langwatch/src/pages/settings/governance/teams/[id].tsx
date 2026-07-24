import {
  Box,
  Heading,
  HStack,
  SimpleGrid,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import { useRouter } from "~/utils/compat/next-router";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { getHexColorForString } from "~/utils/rotatingColors";

const fmtUsd = (n: number) =>
  n === 0 ? "$0.00" : numeral(n).format("$0,0.00");

const fmtRelative = (date: Date | string | null): string => {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
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
 * Per-team governance detail. Reads the same `spendByTeam` rollup
 * the bird's-eye uses, filters in-memory to the requested team id,
 * surfaces the team's headline metrics + a 'see this team in /messages'
 * deep-link. Detail-data depth (per-day spend, per-user breakdown,
 * model mix) defers to a follow-up; this page exists today to honor
 * the bird's-eye click-through invariant.
 */
function GovernanceTeamDetailPage() {
  const router = useRouter();
  const teamId =
    typeof router.query.id === "string" ? router.query.id : null;
  const { organization, organizations } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  // Resolve the team's first project slug for the bird's-eye drill-in
  // link. Teams typically have a primary project (or a small set);
  // navigating to /[projectSlug]/traces lands the admin on the team's
  // workspace via the existing project-shell + auto-switches to
  // PersonalSidebar via the v2 chrome retention discriminator (admin's
  // not a TeamUser → AdminViewingAsBanner fires from DashboardLayout).
  const teamProjectSlug =
    organizations
      ?.flatMap((org) => org.teams ?? [])
      .find((t) => t.id === teamId)?.projects?.[0]?.slug ?? null;

  const teamsQuery = api.activityMonitor.spendByTeam.useQuery(
    { organizationId: orgId, windowDays: 30, limit: 500 },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const team = (teamsQuery.data ?? []).find((t) => t.teamId === teamId);
  const pageTitle = team
    ? `${team.teamName} · AI Governance · LangWatch`
    : "Team · AI Governance · LangWatch";

  return (
    <GovernanceLayout pageTitle={pageTitle}>
      <VStack align="stretch" gap={4} width="full" maxW="container.xl">
        <VStack align="start" gap={1}>
          <Text fontSize="xs" color="fg.muted">
            <Link href="/settings/governance" color="blue.600">
              ← AI Governance
            </Link>{" "}
            ·{" "}
            <Link href="/settings/governance/teams" color="blue.600">
              All teams
            </Link>
          </Text>
          <HStack gap={2}>
            <Box
              width="14px"
              height="14px"
              borderRadius="full"
              backgroundColor={
                team ? getHexColorForString(team.teamName) : "fg.muted"
              }
            />
            <Heading size="md">{team?.teamName ?? "Team not found"}</Heading>
          </HStack>
        </VStack>

        {teamsQuery.isLoading ? (
          <Spinner />
        ) : !team ? (
          <Box
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            padding={5}
          >
            <Text fontSize="sm" color="fg.muted">
              No spend data for this team in the last 30 days. The team
              may not have any associated ingestion sources reporting
              activity yet.
            </Text>
          </Box>
        ) : (
          <>
            <SimpleGrid columns={{ base: 1, md: 4 }} gap={3}>
              <Stat label="Spend (30 d)" value={fmtUsd(team.spendUsd)} />
              <Stat
                label="Requests"
                value={numeral(team.requestCount).format("0,0")}
              />
              <Stat
                label="Last active"
                value={fmtRelative(team.lastActivityIso)}
              />
              <Stat
                label="Sources"
                value={`${team.sourceCount} ${team.sourceCount === 1 ? "source" : "sources"}`}
              />
            </SimpleGrid>

            <Box
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="md"
              padding={4}
            >
              <Text fontSize="sm" fontWeight="medium" marginBottom={1}>
                Detail metrics
              </Text>
              <Text fontSize="xs" color="fg.muted" marginBottom={3}>
                Per-day spend, per-user breakdown, and model mix for this
                team will land here in a follow-up.
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
                    The trace explorer opens with the team's data. A
                    'Viewing as admin' banner stays present + the access
                    is logged to /settings/audit-log.
                  </Text>
                </>
              )}
              <Link
                href="/settings/governance"
                color="blue.600"
                fontSize="sm"
                fontWeight="medium"
              >
                See this team in the bird's-eye chart →
              </Link>
              <Text fontSize="xs" color="fg.subtle" marginTop={1}>
                The chart's {`'By Team'`} toggle exercises the same data
                through one orthogonal lens until the dedicated drilldown
                ships.
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
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
    >
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

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withPermissionGuard("organization:manage", {
    bypassOnboardingRedirect: true,
  })(GovernanceTeamDetailPage),
);
