import {
  Badge,
  Box,
  HStack,
  Heading,
  SimpleGrid,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  AlertTriangle,
  CircleCheck,
  CircleDashed,
  CircleX,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import numeral from "numeral";
import Head from "~/utils/compat/next-head";

import { NotFoundScene } from "~/components/NotFoundScene";
import SettingsLayout from "~/components/SettingsLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * Org-admin "bird's-eye view" of every AI agent / IDE tool / IngestionSource
 * running under the organization. Cross-cutting spend, per-user breakdown,
 * anomaly alerts, source health.
 *
 * v0 ships with deterministic in-memory fixture data so admins can evaluate
 * the UX. Real-data wire-up follows the D2 Activity Monitor backend
 * (IngestionSource ingestion + OCSF normalization + cross-source CH
 * aggregation). The "Preview · mocked data" badge in the header sets
 * expectations until then.
 *
 * Spec: specs/ai-gateway/governance/admin-oversight.feature
 */

const fmtUsd = (n: number) =>
  n === 0 ? "$0.00" : numeral(n).format("$0,0.00");

const fmtRelative = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
};

// ---- v0 mock data --------------------------------------------------------

const MOCK_SUMMARY = {
  spentThisMonthUsd: 12_847.42,
  monthOverMonthPct: 18,
  activeUsersThisMonth: 47,
  newUsersThisWeek: 4,
  openAnomalyCount: 2,
  anomalyBreakdown: { critical: 0, warning: 2, info: 0 },
};

const MOCK_USERS = [
  {
    userId: "user_jane",
    name: "Jane Doe",
    email: "jane@miro.com",
    spendUsd: 1_482.11,
    requests: 12_891,
    lastActivityIso: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    trendVsLastMonthPct: 22,
    mostUsedModel: "claude-3-5-sonnet",
  },
  {
    userId: "user_marc",
    name: "Marc Rovira",
    email: "marc@miro.com",
    spendUsd: 1_211.84,
    requests: 9_412,
    lastActivityIso: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    trendVsLastMonthPct: -8,
    mostUsedModel: "gpt-5-mini",
  },
  {
    userId: "user_florian",
    name: "Florian Schmidt",
    email: "florian@miro.com",
    spendUsd: 942.05,
    requests: 6_201,
    lastActivityIso: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    trendVsLastMonthPct: 5,
    mostUsedModel: "claude-3-5-sonnet",
  },
  {
    userId: "user_sergio",
    name: "Sergio Martín",
    email: "sergio@miro.com",
    spendUsd: 612.33,
    requests: 4_184,
    lastActivityIso: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
    trendVsLastMonthPct: 0,
    mostUsedModel: "gpt-5-mini",
  },
];

const MOCK_ANOMALIES = [
  {
    id: "alert_1",
    severity: "warning" as const,
    rule: "Weekend spend spike",
    source: "Workato production",
    detectedAtIso: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    currentState: "open" as const,
  },
  {
    id: "alert_2",
    severity: "warning" as const,
    rule: "Unusual model — gpt-5-pro outside known list",
    source: "Claude Code (jane@miro.com)",
    detectedAtIso: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
    currentState: "open" as const,
  },
];

const MOCK_INGESTION_SOURCES = [
  {
    id: "src_cowork",
    name: "Miro Cowork",
    sourceType: "claude_cowork",
    status: "healthy" as const,
    lastEventIso: new Date(Date.now() - 1000 * 30).toISOString(),
  },
  {
    id: "src_workato",
    name: "Workato production",
    sourceType: "workato",
    status: "degraded" as const,
    lastEventIso: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
  },
  {
    id: "src_copilot",
    name: "Microsoft Copilot Studio",
    sourceType: "copilot_studio",
    status: "stale" as const,
    lastEventIso: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
];

// ---- Page ----------------------------------------------------------------

function GovernanceOverviewPage() {
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const { enabled: governancePreviewEnabled } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    { projectId: project?.id, enabled: !!project },
  );

  if (!governancePreviewEnabled) {
    return <NotFoundScene />;
  }

  const orgName = organization?.name ?? "your organization";
  const isEmpty =
    MOCK_SUMMARY.spentThisMonthUsd === 0 &&
    MOCK_SUMMARY.activeUsersThisMonth === 0 &&
    MOCK_SUMMARY.openAnomalyCount === 0;

  return (
    <SettingsLayout>
      <Head>
        <title>Governance Overview · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading as="h2" size="lg">
                Governance Overview
              </Heading>
              <Badge colorPalette="purple" variant="subtle">
                Preview · mocked data
              </Badge>
            </HStack>
            <Text color="fg.muted" fontSize="sm">
              Bird&rsquo;s-eye view of all AI activity in {orgName}.
              Spend, users, anomalies, and ingestion-source health in
              one place.
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        {/* Summary cards */}
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
          <SummaryCard
            title="Spent this month"
            value={fmtUsd(MOCK_SUMMARY.spentThisMonthUsd)}
            subline={
              isEmpty
                ? "no AI traffic yet"
                : `${MOCK_SUMMARY.monthOverMonthPct >= 0 ? "↑" : "↓"} ${Math.abs(
                    MOCK_SUMMARY.monthOverMonthPct,
                  )}% vs last month`
            }
            tone={MOCK_SUMMARY.monthOverMonthPct > 25 ? "amber" : "default"}
          />
          <SummaryCard
            title="Active AI users this month"
            value={numeral(MOCK_SUMMARY.activeUsersThisMonth).format("0,0")}
            subline={
              isEmpty
                ? "nobody has used AI yet"
                : `${MOCK_SUMMARY.newUsersThisWeek} new this week`
            }
          />
          <SummaryCard
            title="Anomaly alerts (open)"
            value={numeral(MOCK_SUMMARY.openAnomalyCount).format("0,0")}
            subline={
              isEmpty
                ? "nothing to alert on"
                : `${MOCK_SUMMARY.anomalyBreakdown.critical} critical, ${MOCK_SUMMARY.anomalyBreakdown.warning} warning`
            }
            tone={MOCK_SUMMARY.openAnomalyCount > 0 ? "amber" : "default"}
          />
        </SimpleGrid>

        {isEmpty && (
          <Box
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            padding={5}
          >
            <Text fontWeight="medium" marginBottom={2}>
              Connect a source to start collecting data
            </Text>
            <Text fontSize="sm" color="fg.muted" marginBottom={3}>
              You haven&rsquo;t routed any traffic through LangWatch yet. Pick
              a starting point:
            </Text>
            <HStack gap={3} wrap="wrap">
              <Link href="/settings/model-providers" color="orange.600">
                Add a provider
              </Link>
              <Text color="fg.muted">·</Text>
              <Link href="/settings/routing-policies" color="orange.600">
                Define a routing policy
              </Link>
              <Text color="fg.muted">·</Text>
              <Link
                href="/settings/governance/ingestion-sources"
                color="orange.600"
              >
                Set up an ingestion source
              </Link>
            </HStack>
          </Box>
        )}

        {/* Ingestion source health */}
        <SectionCard
          title="Ingestion sources"
          subline="External AI platforms reporting activity to LangWatch."
        >
          {MOCK_INGESTION_SOURCES.length === 0 ? (
            <VStack align="start" gap={2}>
              <Text color="fg.muted" fontSize="sm">
                No ingestion sources configured.
              </Text>
              <Link
                href="/settings/governance/ingestion-sources/new"
                color="orange.600"
              >
                + Add your first source
              </Link>
            </VStack>
          ) : (
            <HStack gap={3} wrap="wrap">
              {MOCK_INGESTION_SOURCES.map((src) => (
                <SourceChip key={src.id} source={src} />
              ))}
            </HStack>
          )}
        </SectionCard>

        {/* Anomaly alerts */}
        <SectionCard
          title="Active anomaly alerts"
          subline="Cross-source rules that fired and haven't been acknowledged."
          aria-live="polite"
        >
          {MOCK_ANOMALIES.length === 0 ? (
            <Text color="fg.muted" fontSize="sm">
              All quiet — no active alerts.
            </Text>
          ) : (
            <VStack align="stretch" gap={2}>
              {MOCK_ANOMALIES.map((a) => (
                <AnomalyRow key={a.id} alert={a} />
              ))}
            </VStack>
          )}
        </SectionCard>

        {/* Per-user table */}
        <SectionCard
          title="By user"
          subline="Spend and activity per LangWatch member, this month."
        >
          {MOCK_USERS.length === 0 ? (
            <Text color="fg.muted" fontSize="sm">
              No active users this month.
            </Text>
          ) : (
            <VStack align="stretch" gap={0}>
              <UserRowHeader />
              {MOCK_USERS.map((u) => (
                <UserRow key={u.userId} user={u} />
              ))}
            </VStack>
          )}
        </SectionCard>
      </VStack>
    </SettingsLayout>
  );
}

// ---- Sub-components ------------------------------------------------------

type SummaryCardTone = "default" | "amber";

function SummaryCard({
  title,
  value,
  subline,
  tone = "default",
}: {
  title: string;
  value: string;
  subline: string;
  tone?: SummaryCardTone;
}) {
  const accent = tone === "amber" ? "orange.500" : "fg";
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
      _dark={{ borderColor: "border.muted" }}
    >
      <Text
        fontSize="xs"
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="wider"
      >
        {title}
      </Text>
      <Heading as="span" size="lg" color={accent} marginTop={1}>
        {value}
      </Heading>
      <Text fontSize="sm" color="fg.muted" marginTop={1}>
        {subline}
      </Text>
    </Box>
  );
}

function SectionCard({
  title,
  subline,
  children,
  ...rest
}: {
  title: string;
  subline?: string;
  children: React.ReactNode;
  [key: string]: unknown;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={5}
      {...rest}
    >
      <VStack align="start" gap={1} marginBottom={3}>
        <Heading as="h3" size="md">
          {title}
        </Heading>
        {subline && (
          <Text fontSize="sm" color="fg.muted">
            {subline}
          </Text>
        )}
      </VStack>
      {children}
    </Box>
  );
}

const SOURCE_STATUS_ICON = {
  healthy: CircleCheck,
  degraded: CircleDashed,
  stale: CircleDashed,
  down: CircleX,
} as const;

const SOURCE_STATUS_COLOR = {
  healthy: "green.600",
  degraded: "orange.500",
  stale: "yellow.600",
  down: "red.600",
} as const;

function SourceChip({
  source,
}: {
  source: (typeof MOCK_INGESTION_SOURCES)[number];
}) {
  const Icon = SOURCE_STATUS_ICON[source.status];
  const color = SOURCE_STATUS_COLOR[source.status];

  return (
    <Link
      href={`/settings/governance/ingestion-sources/${source.id}`}
      _hover={{ textDecoration: "none" }}
    >
      <HStack
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="full"
        paddingX={3}
        paddingY={2}
        gap={2}
        _hover={{ borderColor: "orange.300" }}
      >
        <Box color={color}>
          <Icon size={14} />
        </Box>
        <VStack align="start" gap={0}>
          <Text fontSize="sm" fontWeight="medium">
            {source.name}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {source.sourceType} · {fmtRelative(source.lastEventIso)}
          </Text>
        </VStack>
      </HStack>
    </Link>
  );
}

const SEVERITY_COLOR = {
  critical: "red.600",
  warning: "orange.500",
  info: "blue.600",
} as const;

type AnomalySeverity = "critical" | "warning" | "info";

function AnomalyRow({
  alert,
}: {
  alert: {
    id: string;
    severity: AnomalySeverity;
    rule: string;
    source: string;
    detectedAtIso: string;
    currentState: "open" | "acknowledged" | "resolved";
  };
}) {
  return (
    <HStack
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      gap={3}
      alignItems="start"
    >
      <Box color={SEVERITY_COLOR[alert.severity]} paddingTop="2px">
        <AlertTriangle size={16} />
      </Box>
      <VStack align="start" gap={0} flex={1}>
        <HStack gap={2}>
          <Badge
            colorPalette={
              alert.severity === "critical"
                ? "red"
                : alert.severity === "warning"
                  ? "orange"
                  : "blue"
            }
          >
            {alert.severity}
          </Badge>
          <Text fontSize="sm" fontWeight="medium">
            {alert.rule}
          </Text>
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          {alert.source} · detected {fmtRelative(alert.detectedAtIso)}
        </Text>
      </VStack>
      <Link
        href={`/settings/governance/anomalies/${alert.id}`}
        fontSize="sm"
        color="orange.600"
      >
        Investigate →
      </Link>
    </HStack>
  );
}

function UserRowHeader() {
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
    >
      <Box flex={3}>User</Box>
      <Box flex={1.2} textAlign="right">
        Spend
      </Box>
      <Box flex={1.2} textAlign="right">
        Requests
      </Box>
      <Box flex={1.2} textAlign="right">
        Last active
      </Box>
      <Box flex={1.5} textAlign="right">
        Trend
      </Box>
      <Box flex={2} textAlign="right">
        Most-used model
      </Box>
    </HStack>
  );
}

function UserRow({ user }: { user: (typeof MOCK_USERS)[number] }) {
  const TrendIcon = user.trendVsLastMonthPct >= 0 ? TrendingUp : TrendingDown;
  const trendColor =
    user.trendVsLastMonthPct >= 25
      ? "orange.500"
      : user.trendVsLastMonthPct >= 0
        ? "fg.muted"
        : "green.600";

  return (
    <Link
      href={`/settings/governance/users/${user.userId}`}
      _hover={{ textDecoration: "none", backgroundColor: "bg.muted" }}
    >
      <HStack
        paddingY={3}
        paddingX={3}
        borderBottomWidth="1px"
        borderColor="border.muted"
      >
        <Box flex={3}>
          <Text fontSize="sm" fontWeight="medium">
            {user.name}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {user.email}
          </Text>
        </Box>
        <Box flex={1.2} textAlign="right" fontSize="sm">
          {fmtUsd(user.spendUsd)}
        </Box>
        <Box flex={1.2} textAlign="right" fontSize="sm" color="fg.muted">
          {numeral(user.requests).format("0,0")}
        </Box>
        <Box flex={1.2} textAlign="right" fontSize="xs" color="fg.muted">
          {fmtRelative(user.lastActivityIso)}
        </Box>
        <Box flex={1.5} textAlign="right" fontSize="sm">
          <HStack justifyContent="end" gap={1}>
            <Box color={trendColor}>
              <TrendIcon size={14} />
            </Box>
            <Text color={trendColor}>
              {user.trendVsLastMonthPct >= 0 ? "+" : ""}
              {user.trendVsLastMonthPct}%
            </Text>
          </HStack>
        </Box>
        <Box flex={2} textAlign="right" fontSize="sm" color="fg.muted">
          {user.mostUsedModel}
        </Box>
      </HStack>
    </Link>
  );
}

export default withPermissionGuard("organization:manage", {})(
  GovernanceOverviewPage,
);
