import {
  Badge,
  Box,
  Heading,
  HStack,
  SimpleGrid,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  CheckCircle2,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleX,
} from "lucide-react";
import numeral from "numeral";
import Head from "~/utils/compat/next-head";

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { NotFoundScene } from "~/components/NotFoundScene";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

/**
 * Org-admin overview of AI governance state — spend, users, anomalies,
 * IngestionSource health. Wires the api.activityMonitor.* procedures
 * (Sergey Option B) for live reads off gateway_activity_events.
 *
 * When no traffic has been ingested yet, the page shows a setup
 * checklist instead of empty zeroes — a "configure your first source"
 * onboarding rather than an empty wasteland.
 *
 * Spec: specs/ai-gateway/governance/admin-oversight.feature
 */

type Source = RouterOutputs["ingestionSources"]["list"][number];
type SourceHealth = RouterOutputs["activityMonitor"]["ingestionSourcesHealth"][number];
type SpendByUser = RouterOutputs["activityMonitor"]["spendByUser"][number];

const fmtUsd = (n: number) =>
  n === 0 ? "$0.00" : numeral(n).format("$0,0.00");

const fmtRelative = (date: Date | string | null): string => {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
};

function GovernanceOverviewPage() {
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const { enabled: governancePreviewEnabled } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    { projectId: project?.id, enabled: !!project },
  );

  const sourcesQuery = api.ingestionSources.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const summaryQuery = api.activityMonitor.summary.useQuery(
    { organizationId: orgId, windowDays: 30 },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const usersQuery = api.activityMonitor.spendByUser.useQuery(
    { organizationId: orgId, windowDays: 30, limit: 50 },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const healthQuery = api.activityMonitor.ingestionSourcesHealth.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const anomaliesQuery = api.activityMonitor.recentAnomalies.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  if (!governancePreviewEnabled) {
    return <NotFoundScene />;
  }

  const sources = sourcesQuery.data ?? [];
  const policies = policiesQuery.data ?? [];
  const summary = summaryQuery.data;
  const users = usersQuery.data ?? [];
  const sourceHealth = healthQuery.data ?? [];
  const anomalies = anomaliesQuery.data ?? [];

  const hasSources = sources.length > 0;
  const hasPolicies = policies.length > 0;
  const hasTraffic =
    !!summary &&
    (summary.spentThisWindowUsd > 0 ||
      summary.activeUsersThisWindow > 0 ||
      summary.openAnomalyCount > 0);

  return (
    <GovernanceLayout>
      <Head>
        <title>Governance · LangWatch</title>
      </Head>

      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading size="md">Governance</Heading>
              <Badge colorPalette="purple" variant="subtle">
                Preview
              </Badge>
            </HStack>
            <Text color="fg.muted" fontSize="sm">
              Spend, users, anomalies, and ingestion-source health for
              the organization. Window: last 30 days.
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        {!hasTraffic && (
          <Box
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            padding={5}
          >
            <VStack align="start" gap={1} marginBottom={4}>
              <Heading as="h3" size="sm">
                Setup checklist
              </Heading>
              <Text fontSize="sm" color="fg.muted">
                Complete each step to start collecting governance data.
                Live metrics replace this checklist once your first
                source is reporting events.
              </Text>
            </VStack>
            <VStack align="stretch" gap={2}>
              <SetupItem
                done={hasPolicies}
                title="Define a routing policy"
                description="Tell virtual keys which providers + models to route through."
                href="/settings/routing-policies"
                ctaLabel={
                  hasPolicies
                    ? `${policies.length} policy${policies.length === 1 ? "" : "ies"} configured`
                    : "Add a routing policy"
                }
              />
              <SetupItem
                done={hasSources}
                title="Connect an ingestion source"
                description="Map an external AI platform into the activity monitor via OTel push, webhook, or S3 audit drop."
                href="/settings/governance/ingestion-sources"
                ctaLabel={
                  hasSources
                    ? `${sources.length} source${sources.length === 1 ? "" : "s"} configured`
                    : "Add an ingestion source"
                }
              />
              <SetupItem
                done={false}
                title="Define anomaly rules"
                description="Set thresholds that page on-call when activity drifts."
                href="/settings/governance/anomaly-rules"
                ctaLabel="Anomaly rules"
                upcoming
              />
            </VStack>
          </Box>
        )}

        {hasTraffic && summary && (
          <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
            <SummaryCard
              title="Spend (30 d)"
              value={fmtUsd(summary.spentThisWindowUsd)}
              subline={
                summary.spentThisWindowUsd === 0
                  ? "no traffic this window"
                  : `${summary.windowOverPreviousPct >= 0 ? "↑" : "↓"} ${Math.abs(
                      summary.windowOverPreviousPct,
                    )}% vs previous`
              }
              tone={summary.windowOverPreviousPct > 25 ? "amber" : "default"}
            />
            <SummaryCard
              title="Active users (30 d)"
              value={numeral(summary.activeUsersThisWindow).format("0,0")}
              subline={
                summary.activeUsersThisWindow === 0
                  ? "nobody used AI this window"
                  : `${summary.newUsersThisWindow} new this window`
              }
            />
            <SummaryCard
              title="Open anomalies"
              value={numeral(summary.openAnomalyCount).format("0,0")}
              subline={
                summary.openAnomalyCount === 0
                  ? "nothing to alert on"
                  : `${summary.anomalyBreakdown.critical} critical · ${summary.anomalyBreakdown.warning} warning`
              }
              tone={summary.openAnomalyCount > 0 ? "amber" : "default"}
            />
          </SimpleGrid>
        )}

        <SectionCard
          title="Ingestion sources"
          subline="External AI platforms reporting activity to LangWatch."
        >
          {sourceHealth.length === 0 ? (
            <VStack align="start" gap={2}>
              <Text color="fg.muted" fontSize="sm">
                No ingestion sources configured.
              </Text>
              <Link
                href="/settings/governance/ingestion-sources"
                color="orange.600"
              >
                + Add a source
              </Link>
            </VStack>
          ) : (
            <HStack gap={3} wrap="wrap">
              {sourceHealth.map((src) => (
                <SourceChip key={src.id} source={src} />
              ))}
            </HStack>
          )}
        </SectionCard>

        <SectionCard
          title="Recent anomalies"
          subline="Cross-source rules that fired and haven't been acknowledged."
          aria-live="polite"
        >
          {anomalies.length === 0 ? (
            <Text color="fg.muted" fontSize="sm">
              {hasTraffic
                ? "All quiet — no active alerts."
                : "Available when the detection backend ships."}
            </Text>
          ) : (
            <VStack align="stretch" gap={2}>
              {anomalies.map((a) => (
                <AnomalyRow key={a.id} alert={a} />
              ))}
            </VStack>
          )}
        </SectionCard>

        <SectionCard
          title="By user"
          subline="Spend and activity per LangWatch member, last 30 days."
        >
          {users.length === 0 ? (
            <Text color="fg.muted" fontSize="sm">
              No active users this window.
            </Text>
          ) : (
            <VStack align="stretch" gap={0}>
              <UserRowHeader />
              {users.map((u) => (
                <UserRow key={u.actor} user={u} />
              ))}
            </VStack>
          )}
        </SectionCard>
      </VStack>
    </GovernanceLayout>
  );
}

function SetupItem({
  done,
  title,
  description,
  href,
  ctaLabel,
  upcoming,
}: {
  done: boolean;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
  upcoming?: boolean;
}) {
  return (
    <HStack
      borderWidth="1px"
      borderColor={done ? "green.200" : "border.muted"}
      borderRadius="sm"
      padding={3}
      gap={3}
      alignItems="start"
      opacity={upcoming ? 0.7 : 1}
    >
      <Box color={done ? "green.500" : "fg.muted"} paddingTop="2px">
        {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
      </Box>
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <HStack gap={2}>
          <Text fontSize="sm" fontWeight="medium">
            {title}
          </Text>
          {upcoming && (
            <Badge size="sm" variant="surface" colorPalette="gray">
              Coming soon
            </Badge>
          )}
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          {description}
        </Text>
      </VStack>
      <Link href={href} color="orange.600">
        {ctaLabel}
      </Link>
    </HStack>
  );
}

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
      <Heading as="span" size="md" color={accent} marginTop={1}>
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
        <Heading as="h3" size="sm">
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
  active: CircleCheck,
  awaiting_first_event: CircleDashed,
  disabled: CircleX,
} as const;

const SOURCE_STATUS_COLOR = {
  active: "green.600",
  awaiting_first_event: "orange.500",
  disabled: "fg.muted",
} as const;

function SourceChip({ source }: { source: SourceHealth }) {
  const Icon =
    SOURCE_STATUS_ICON[
      (source.status as keyof typeof SOURCE_STATUS_ICON) ?? "awaiting_first_event"
    ] ?? CircleDashed;
  const color =
    SOURCE_STATUS_COLOR[
      (source.status as keyof typeof SOURCE_STATUS_COLOR) ?? "awaiting_first_event"
    ] ?? "fg.muted";

  return (
    <Link
      href="/settings/governance/ingestion-sources"
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
            {source.sourceType} · {fmtRelative(source.lastEventIso ?? null)}
            {source.eventsLast24h > 0 &&
              ` · ${numeral(source.eventsLast24h).format("0,0")} events / 24h`}
          </Text>
        </VStack>
      </HStack>
    </Link>
  );
}

type AnomalySeverity = "critical" | "warning" | "info";

const SEVERITY_COLOR: Record<AnomalySeverity, string> = {
  critical: "red.600",
  warning: "orange.500",
  info: "blue.600",
};

function AnomalyRow({
  alert,
}: {
  alert: {
    id: string;
    severity: AnomalySeverity;
    rule: string;
    sourceLabel: string;
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
        <CircleDashed size={16} />
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
          {alert.sourceLabel} · detected {fmtRelative(alert.detectedAtIso)}
        </Text>
      </VStack>
      <Badge size="sm" variant="surface">
        {alert.currentState}
      </Badge>
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
      <Box flex={2}>Spend</Box>
      <Box flex={2}>Requests</Box>
      <Box flex={2}>Last active</Box>
      <Box flex={2}>Trend</Box>
      <Box flex={2}>Most-used</Box>
    </HStack>
  );
}

function UserRow({ user }: { user: SpendByUser }) {
  const trendArrow =
    user.trendVsPreviousPct > 0
      ? "↑"
      : user.trendVsPreviousPct < 0
        ? "↓"
        : "·";
  const trendColor =
    user.trendVsPreviousPct > 25
      ? "orange.500"
      : user.trendVsPreviousPct < -25
        ? "blue.500"
        : "fg.muted";
  return (
    <HStack
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      fontSize="sm"
    >
      <Box flex={3}>
        <Text fontWeight="medium">{user.actor}</Text>
      </Box>
      <Box flex={2}>{fmtUsd(user.spendUsd)}</Box>
      <Box flex={2}>{numeral(user.requests).format("0,0")}</Box>
      <Box flex={2} color="fg.muted">
        {fmtRelative(user.lastActivityIso)}
      </Box>
      <Box flex={2} color={trendColor}>
        {trendArrow} {Math.abs(user.trendVsPreviousPct)}%
      </Box>
      <Box flex={2} color="fg.muted">
        {user.mostUsedTarget}
      </Box>
    </HStack>
  );
}

export default withPermissionGuard("organization:manage", {})(
  GovernanceOverviewPage,
);
