import {
  Box,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import numeral from "numeral";
import Head from "~/utils/compat/next-head";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { getHexColorForString } from "~/utils/rotatingColors";

type SpendByTeam = RouterOutputs["activityMonitor"]["spendByTeam"][number];
type SortField = "spend" | "requests" | "lastActivity";

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

function fmtTrendPct(pct: number): string {
  const abs = Math.abs(pct);
  if (abs >= 1000) return ">1000%";
  if (abs < 1) return "0%";
  return `${Math.round(abs)}%`;
}

function GovernanceTeamsListPage() {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const { enabled, isLoading: ffLoading } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    {
      organizationId: orgId,
      enabled: !!orgId,
    },
  );

  const [sortBy, setSortBy] = useState<SortField>("spend");
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

  if (ffLoading) return <LoadingScreen />;
  if (!enabled) return <NotFoundScene />;

  const teams = teamsQuery.data ?? [];

  return (
    <GovernanceLayout>
      <Head>
        <title>Teams · Governance · LangWatch</title>
      </Head>
      <VStack align="stretch" gap={4} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={1}>
            <Text fontSize="xs" color="fg.muted">
              <Link href="/settings/governance" color="orange.600">
                ← Governance
              </Link>{" "}
              · All teams
            </Text>
            <Heading size="md">All teams by spend</Heading>
            <Text color="fg.muted" fontSize="sm">
              Every team that reported activity in the last 30 days.
              Click a row to drill into a single team.
            </Text>
          </VStack>
        </HStack>

        <HStack gap={2}>
          <Text fontSize="sm" color="fg.muted">
            Sort by:
          </Text>
          <SortChips value={sortBy} onChange={setSortBy} />
        </HStack>

        <VStack
          align="stretch"
          gap={0}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          overflow="hidden"
        >
          <Header />
          {teamsQuery.isLoading ? (
            <Box padding={6}>
              <Spinner />
            </Box>
          ) : teams.length === 0 ? (
            <Box padding={6} color="fg.muted" fontSize="sm">
              No team activity this window.
            </Box>
          ) : (
            teams.map((t) => <Row key={t.teamId ?? "org-wide"} team={t} />)
          )}
        </VStack>
        <Text fontSize="xs" color="fg.muted">
          {teams.length} team{teams.length === 1 ? "" : "s"} shown.
        </Text>
      </VStack>
    </GovernanceLayout>
  );
}

function SortChips({
  value,
  onChange,
}: {
  value: SortField;
  onChange: (v: SortField) => void;
}) {
  const opts: Array<{ key: SortField; label: string }> = [
    { key: "spend", label: "Spend" },
    { key: "requests", label: "Requests" },
    { key: "lastActivity", label: "Last active" },
  ];
  return (
    <HStack gap={1}>
      {opts.map((o) => {
        const active = o.key === value;
        return (
          <Box
            key={o.key}
            paddingX={3}
            paddingY={1}
            borderRadius="full"
            borderWidth="1px"
            borderColor={active ? "orange.500" : "border.muted"}
            backgroundColor={active ? "orange.50" : "transparent"}
            color={active ? "orange.700" : "fg.muted"}
            fontSize="xs"
            fontWeight="medium"
            cursor="pointer"
            onClick={() => onChange(o.key)}
            _hover={active ? undefined : { borderColor: "orange.300" }}
          >
            {o.label}
          </Box>
        );
      })}
    </HStack>
  );
}

function Header() {
  return (
    <HStack
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      fontSize="xs"
      fontWeight="semibold"
      color="fg.muted"
      textTransform="uppercase"
      letterSpacing="wider"
      backgroundColor="bg.subtle"
    >
      <Box flex={3}>Team</Box>
      <Box flex={2}>Spend</Box>
      <Box flex={2}>Requests</Box>
      <Box flex={2}>Last active</Box>
      <Box flex={2}>Trend</Box>
      <Box flex={2}>Sources</Box>
    </HStack>
  );
}

function Row({ team }: { team: SpendByTeam }) {
  const isOrgWide = !team.teamId;
  const dotColor = isOrgWide ? "#94a3b8" : getHexColorForString(team.teamName);
  const arrow =
    team.deltaPctVsPriorWindow > 0
      ? "↑"
      : team.deltaPctVsPriorWindow < 0
        ? "↓"
        : "·";
  const trendColor = !team.hasPriorBaseline
    ? "fg.muted"
    : team.deltaPctVsPriorWindow > 25
      ? "orange.500"
      : team.deltaPctVsPriorWindow < -25
        ? "blue.500"
        : "fg.muted";
  const inner = (
    <HStack
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      fontSize="sm"
      _hover={isOrgWide ? undefined : { backgroundColor: "bg.subtle" }}
      cursor={isOrgWide ? "default" : "pointer"}
    >
      <Box flex={3}>
        <HStack gap={2}>
          <Box
            width="10px"
            height="10px"
            borderRadius="full"
            backgroundColor={dotColor}
            flexShrink={0}
          />
          <Text fontWeight="medium" color={isOrgWide ? "fg.muted" : "fg"}>
            {team.teamName}
          </Text>
        </HStack>
      </Box>
      <Box flex={2}>{fmtUsd(team.spendUsd)}</Box>
      <Box flex={2}>{numeral(team.requestCount).format("0,0")}</Box>
      <Box flex={2} color="fg.muted">
        {fmtRelative(team.lastActivityIso)}
      </Box>
      <Box flex={2} color={trendColor}>
        {team.hasPriorBaseline
          ? `${arrow} ${fmtTrendPct(team.deltaPctVsPriorWindow)}`
          : "—"}
      </Box>
      <Box flex={2} color="fg.muted">
        {team.sourceCount} {team.sourceCount === 1 ? "source" : "sources"}
      </Box>
    </HStack>
  );
  if (isOrgWide) return inner;
  return (
    <Link
      href={`/settings/governance/teams/${team.teamId}`}
      display="block"
      width="full"
      _hover={{ textDecoration: "none" }}
    >
      {inner}
    </Link>
  );
}

export default withPermissionGuard("organization:manage", {
  bypassOnboardingRedirect: true,
})(GovernanceTeamsListPage);
