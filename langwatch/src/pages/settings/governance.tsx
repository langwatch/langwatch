import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  SimpleGrid,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleX,
} from "lucide-react";
import numeral from "numeral";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { QuarantineFillAlert } from "~/components/governance/QuarantineFillAlert";
import { SpendByTeamBar } from "~/components/governance/SpendByTeamBar";
import {
  SpendOverTimeChart,
  type GroupBy,
} from "~/components/governance/SpendOverTimeChart";
import { InstallCliCard } from "~/components/me/InstallCliCard";
import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { getHexColorForString } from "~/utils/rotatingColors";

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
type SpendByTeam = RouterOutputs["activityMonitor"]["spendByTeam"][number];

const fmtUsd = (n: number) =>
  n === 0 ? "$0.00" : numeral(n).format("$0,0.00");

const fmtRelative = (date: Date | string | null): string => {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  // Future-dated sources (clock skew between LangWatch and the
  // reporting source, or seed scripts that drift past `now`) would
  // otherwise render as "-63236s ago". Clamp to "just now" instead.
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

function GovernanceOverviewPage() {
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  const { enabled: governancePreviewEnabled, isLoading: ffLoading } =
    useFeatureFlag("release_ui_ai_governance_enabled", {
      projectId: project?.id,
      organizationId: orgId,
      enabled: !!orgId,
    });

  const sourcesQuery = api.ingestionSources.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );
  const anomalyRulesQuery = api.anomalyRules.list.useQuery(
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
  const teamsQuery = api.activityMonitor.spendByTeam.useQuery(
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
  const [chartGroupBy, setChartGroupBy] = useState<GroupBy>("team");
  const spendOverTimeQuery = api.activityMonitor.spendOverTime.useQuery(
    { organizationId: orgId, windowDays: 30, groupBy: chartGroupBy },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  if (ffLoading) return <LoadingScreen />;
  if (!governancePreviewEnabled) return <NotFoundScene />;

  const sources = sourcesQuery.data ?? [];
  const policies = policiesQuery.data ?? [];
  const summary = summaryQuery.data;
  const users = usersQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const sourceHealth = healthQuery.data ?? [];
  const anomalies = anomaliesQuery.data ?? [];
  const anomalyRules = anomalyRulesQuery.data ?? [];

  const hasSources = sources.length > 0;
  const hasPolicies = policies.length > 0;
  const hasAnomalyRules = anomalyRules.length > 0;
  const hasTraffic =
    !!summary &&
    (summary.spentThisWindowUsd > 0 ||
      summary.activeUsersThisWindow > 0 ||
      summary.openAnomalyCount > 0);

  return (
    <GovernanceLayout pageTitle="AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading size="md">AI Governance</Heading>
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

        {orgId && <QuarantineFillAlert organizationId={orgId} />}

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
                ingestion source is reporting events. (AI Gateway
                traffic shows in <Link href="/gateway/usage">Gateway →
                Usage</Link>; this dashboard rolls up signals from
                ingestion sources beyond the gateway.)
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
                    ? `${policies.length} ${policies.length === 1 ? "policy" : "policies"} configured`
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
                done={hasAnomalyRules}
                title="Define anomaly rules"
                description="Set thresholds that page on-call when activity drifts."
                href="/settings/governance/anomaly-rules"
                ctaLabel={
                  hasAnomalyRules
                    ? `${anomalyRules.length} rule${anomalyRules.length === 1 ? "" : "s"} configured`
                    : "Anomaly rules"
                }
              />
            </VStack>
            <Box marginTop={5}>
              <InstallCliCard
                heading="Install the CLI to onboard your team"
                subline="Members install the CLI on their devices to start using AI tools through LangWatch. Run `langwatch login` after install to authenticate."
              />
            </Box>
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
                  : !summary.hasPriorBaseline ||
                      summary.spentThisWindowUsd < 10
                    ? "insufficient baseline"
                    : `${summary.windowOverPreviousPct >= 0 ? "↑" : "↓"} ${fmtTrendPct(summary.windowOverPreviousPct)} vs previous`
              }
              tone={
                summary.hasPriorBaseline &&
                summary.spentThisWindowUsd >= 10 &&
                summary.windowOverPreviousPct > 25
                  ? "amber"
                  : "default"
              }
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

        {/*
         * Monitoring sections lead the page when populated — admin's
         * daily-driver answer to "what happened, where, who" without
         * scrolling past config knobs. Config (CLI session TTL +
         * content-logging mode) lives below as occasional-touch
         * controls. Setup checklist + empty-state ingestion-sources
         * placeholder render above when there's no traffic yet.
         */}

        {hasTraffic && (
          <SectionCard
            title="Spend over time"
            subline="Daily UTC buckets, last 30 days. Toggle the breakdown to see which dimension is driving the trend."
            actions={
              <GroupByToggle
                value={chartGroupBy}
                onChange={setChartGroupBy}
              />
            }
          >
            <SpendOverTimeChart
              buckets={spendOverTimeQuery.data?.buckets}
              groupBy={chartGroupBy}
              emptyHint="Connect an ingestion source to start collecting governance data."
            />
          </SectionCard>
        )}

        {teams.length > 0 && (
          <SectionCard title="Spend share across teams">
            <SpendByTeamBar teams={teams} />
          </SectionCard>
        )}

        <SectionCard
          title="Top teams by spend"
          subline="Top 5 teams ranked by spend (last 30 days). Sources without a team land under 'Org-wide'."
          actions={
            teams.length > 0 ? (
              <Link
                href="/settings/governance/teams"
                color="blue.600"
                fontSize="sm"
              >
                View all teams →
              </Link>
            ) : null
          }
        >
          {teams.length === 0 ? (
            <Text color="fg.muted" fontSize="sm">
              No team activity this window.
            </Text>
          ) : (
            <VStack align="stretch" gap={0}>
              <TeamRowHeader />
              {teams.slice(0, 5).map((t) => (
                <TeamRow key={t.teamId ?? "org-wide"} team={t} />
              ))}
            </VStack>
          )}
        </SectionCard>

        <SectionCard
          title="Top users by spend"
          subline="Top 5 LangWatch members ranked by spend (last 30 days)."
          actions={
            users.length > 0 ? (
              <Link
                href="/settings/governance/users"
                color="blue.600"
                fontSize="sm"
              >
                View all users →
              </Link>
            ) : null
          }
        >
          {users.length === 0 ? (
            <Text color="fg.muted" fontSize="sm">
              No active users this window.
            </Text>
          ) : (
            <VStack align="stretch" gap={0}>
              <UserRowHeader />
              {users.slice(0, 5).map((u) => (
                <UserRow key={u.actor} user={u} />
              ))}
            </VStack>
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
                color="blue.600"
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

        <SessionPolicySection organizationId={orgId} />

        <ContentModeSection organizationId={orgId} />
      </VStack>
    </GovernanceLayout>
  );
}

function SessionPolicySection({ organizationId }: { organizationId: string }) {
  const policyQuery = api.sessionPolicy.get.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();
  const setMutation = api.sessionPolicy.setMaxDuration.useMutation({
    onSuccess: () => {
      void utils.sessionPolicy.get.invalidate({ organizationId });
      toaster.create({ title: "Session policy saved", type: "success" });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to save",
        description: err.message,
        type: "error",
      });
    },
  });

  const persisted = policyQuery.data?.maxSessionDurationDays ?? 0;
  const [value, setValue] = useState<string>("0");

  useEffect(() => {
    if (policyQuery.data) setValue(String(persisted));
  }, [persisted, policyQuery.data]);

  const parsed = Number(value);
  const isInvalid =
    !Number.isInteger(parsed) || parsed < 0 || parsed > 365;
  const isDirty = !isInvalid && parsed !== persisted;
  const onSave = () => {
    if (isInvalid || !organizationId) return;
    setMutation.mutate({ organizationId, maxSessionDurationDays: parsed });
  };
  const onReset = () => setValue(String(persisted));

  return (
    <SectionCard
      title="CLI session policy"
      subline="Maximum lifetime of a CLI/device session before re-login is required. Applies to every member's `langwatch login` session."
    >
      <VStack align="stretch" gap={3}>
        <HStack gap={3} align="end">
          <VStack align="start" gap={1}>
            <Text fontSize="xs" color="fg.muted">
              Days (0 = unbounded)
            </Text>
            <Input
              type="number"
              min={0}
              max={365}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              width="120px"
              size="sm"
              borderColor={isInvalid ? "red.300" : undefined}
            />
          </VStack>
          <Button
            size="sm"
            onClick={onSave}
            loading={setMutation.isPending}
            disabled={!isDirty || isInvalid}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            disabled={!isDirty || setMutation.isPending}
          >
            Reset
          </Button>
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          Suggested presets: <code>7</code> (high-security) ·{" "}
          <code>30</code> (standard) · <code>0</code> (open-source / small
          teams). Values higher than the natural refresh-token life (~30d) cap
          at the refresh-token expiry.
        </Text>
        {isInvalid && (
          <Text fontSize="xs" color="red.600">
            Enter an integer between 0 and 365.
          </Text>
        )}
      </VStack>
    </SectionCard>
  );
}

type ContentMode = "full" | "strip_io" | "strip_all";

const CONTENT_MODE_COPY: Record<ContentMode, { title: string; helper: string }> = {
  full: {
    title: "Full",
    helper:
      "Default. Every gen_ai prompt, completion, and system message lands in ClickHouse. Use this if you need to inspect or debug LLM payloads.",
  },
  strip_io: {
    title: "Strip prompts & completions",
    helper:
      "Drop user prompts and assistant completions before write — keep tokens, cost, model name, latency, and span shape intact for cost & ops dashboards. System messages still flow.",
  },
  strip_all: {
    title: "Strip everything",
    helper:
      "Drop prompts, completions, AND system instructions. ClickHouse only sees metadata: tokens, cost, model, latency, and span structure. Strongest privacy posture; no LLM-content debugging from observability data.",
  },
};

function ContentModeSection({ organizationId }: { organizationId: string }) {
  const policyQuery = api.sessionPolicy.get.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();
  const setMutation = api.sessionPolicy.setContentMode.useMutation({
    onSuccess: () => {
      void utils.sessionPolicy.get.invalidate({ organizationId });
      toaster.create({ title: "Content mode saved", type: "success" });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to save",
        description: err.message,
        type: "error",
      });
    },
  });

  const persisted: ContentMode = policyQuery.data?.contentMode ?? "full";

  return (
    <SectionCard
      title="Content logging mode"
      subline="Controls whether gen_ai prompt/completion/system payloads from gateway-origin spans are persisted to ClickHouse. The receiver strips before write — content never lands at rest, even briefly."
    >
      <VStack align="stretch" gap={2}>
        {(Object.keys(CONTENT_MODE_COPY) as ContentMode[]).map((mode) => {
          const copy = CONTENT_MODE_COPY[mode];
          const isActive = persisted === mode;
          const isPending = setMutation.isPending && setMutation.variables?.contentMode === mode;
          return (
            <Box
              key={mode}
              borderWidth="1px"
              borderColor={isActive ? "orange.300" : "border.muted"}
              backgroundColor={isActive ? "orange.50" : "transparent"}
              borderRadius="sm"
              padding={3}
              cursor={isActive || isPending ? "default" : "pointer"}
              opacity={isPending ? 0.6 : 1}
              onClick={() => {
                if (isActive || isPending || !organizationId) return;
                setMutation.mutate({ organizationId, contentMode: mode });
              }}
            >
              <HStack align="start" gap={3}>
                <Box
                  width="14px"
                  height="14px"
                  borderRadius="full"
                  borderWidth="1px"
                  borderColor={isActive ? "orange.500" : "border.emphasis"}
                  backgroundColor={isActive ? "orange.500" : "transparent"}
                  flexShrink={0}
                  marginTop={1}
                />
                <VStack align="start" gap={0} flex={1}>
                  <HStack gap={2}>
                    <Text fontSize="sm" fontWeight={isActive ? "semibold" : "medium"}>
                      {copy.title}
                    </Text>
                    {isActive && (
                      <Badge variant="surface" colorPalette="orange" size="sm">
                        active
                      </Badge>
                    )}
                  </HStack>
                  <Text fontSize="xs" color="fg.muted">
                    {copy.helper}
                  </Text>
                </VStack>
              </HStack>
            </Box>
          );
        })}
        <Text fontSize="xs" color="fg.muted">
          Mode flips apply to new spans only. Spans already in ClickHouse are
          NOT retroactively scrubbed — change before the data starts flowing
          if you need a guarantee.
        </Text>
      </VStack>
    </SectionCard>
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
      <Link href={href} color="blue.600">
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

function GroupByToggle({
  value,
  onChange,
}: {
  value: GroupBy;
  onChange: (next: GroupBy) => void;
}) {
  const options: GroupBy[] = ["team", "user", "model"];
  return (
    <HStack
      gap={0}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      overflow="hidden"
    >
      {options.map((opt, i) => {
        const active = opt === value;
        return (
          <Button
            key={opt}
            size="xs"
            variant={active ? "solid" : "ghost"}
            colorPalette={active ? "orange" : "gray"}
            onClick={() => onChange(opt)}
            borderRadius={0}
            borderRightWidth={i < options.length - 1 ? "1px" : 0}
            borderColor="border.muted"
            textTransform="capitalize"
          >
            By {opt}
          </Button>
        );
      })}
    </HStack>
  );
}

function SectionCard({
  title,
  subline,
  actions,
  children,
  ...rest
}: {
  title: string;
  subline?: string;
  actions?: React.ReactNode;
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
      <HStack align="start" justify="space-between" marginBottom={3} gap={4}>
        <VStack align="start" gap={1} flex={1}>
          <Heading as="h3" size="sm">
            {title}
          </Heading>
          {subline && (
            <Text fontSize="sm" color="fg.muted">
              {subline}
            </Text>
          )}
        </VStack>
        {actions && <Box flexShrink={0}>{actions}</Box>}
      </HStack>
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

function TeamRowHeader() {
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
      <Box flex={3}>Team</Box>
      <Box flex={2}>Spend</Box>
      <Box flex={2}>Requests</Box>
      <Box flex={2}>Last active</Box>
      <Box flex={2}>Trend</Box>
      <Box flex={2}>Sources</Box>
    </HStack>
  );
}

/**
 * Trend cell rendering — three states:
 *   1. No prior baseline (first window of activity, or seed without
 *      prior-window distribution): render '—' muted. Avoids the
 *      misleading +100% on every brand-new team / fresh customer.
 *   2. |delta| > 25%: orange (anomalous spike) or blue (sharp drop).
 *      Threshold matches `summary.windowOverPreviousPct` palette.
 *   3. otherwise: gray neutral with arrow + %.
 */
/**
 * Cap absurd display values caused by tiny prior baselines (e.g.
 * prior=$0.0001, current=$1 → +999900%). Above 1000% we just show
 * ">1000%" — the actual number is uninformative noise. Below 1% we
 * show "+0%" / "-0%" rather than "+0.0034%" pixel grit. The tone
 * threshold uses the raw value so a real 5000% growth still flags
 * orange-amber even though we display ">1000%".
 */
function fmtTrendPct(pct: number): string {
  const abs = Math.abs(pct);
  if (abs >= 1000) return ">1000%";
  if (abs < 1) return "0%";
  return `${Math.round(abs)}%`;
}

function TrendCell({
  pct,
  hasBaseline,
}: {
  pct: number;
  hasBaseline: boolean;
}) {
  if (!hasBaseline) {
    return (
      <Box flex={2} color="fg.muted">
        —
      </Box>
    );
  }
  const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "·";
  const color =
    pct > 25 ? "orange.500" : pct < -25 ? "blue.500" : "fg.muted";
  return (
    <Box flex={2} color={color}>
      {arrow} {fmtTrendPct(pct)}
    </Box>
  );
}

function TeamRow({ team }: { team: SpendByTeam }) {
  const isOrgWide = !team.teamId;
  const dotColor = isOrgWide ? "#94a3b8" : getHexColorForString(team.teamName);
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
          <VStack align="start" gap={0}>
            <Text fontWeight="medium" color={isOrgWide ? "fg.muted" : "fg"}>
              {team.teamName}
            </Text>
            {isOrgWide && (
              <Text fontSize="xs" color="fg.subtle">
                synthetic — sources without a team
              </Text>
            )}
          </VStack>
        </HStack>
      </Box>
      <Box flex={2}>{fmtUsd(team.spendUsd)}</Box>
      <Box flex={2}>{numeral(team.requestCount).format("0,0")}</Box>
      <Box flex={2} color="fg.muted">
        {fmtRelative(team.lastActivityIso)}
      </Box>
      <TrendCell
        pct={team.deltaPctVsPriorWindow}
        hasBaseline={team.hasPriorBaseline}
      />
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

function UserRow({ user }: { user: SpendByUser }) {
  const dotColor = getHexColorForString(user.actor);
  return (
    <Link
      href={`/settings/governance/users/${encodeURIComponent(user.actor)}`}
      display="block"
      width="full"
      _hover={{ textDecoration: "none" }}
    >
    <HStack
      paddingY={2}
      paddingX={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      fontSize="sm"
      _hover={{ backgroundColor: "bg.subtle" }}
      cursor="pointer"
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
          <Text fontWeight="medium">{user.actor}</Text>
        </HStack>
      </Box>
      <Box flex={2}>{fmtUsd(user.spendUsd)}</Box>
      <Box flex={2}>{numeral(user.requests).format("0,0")}</Box>
      <Box flex={2} color="fg.muted">
        {fmtRelative(user.lastActivityIso)}
      </Box>
      <TrendCell
        pct={user.trendVsPreviousPct}
        hasBaseline={user.hasPriorBaseline}
      />
      <Box flex={2} color="fg.muted">
        {user.mostUsedTarget}
      </Box>
    </HStack>
    </Link>
  );
}

export default withPermissionGuard("organization:manage", {
  bypassOnboardingRedirect: true,
})(GovernanceOverviewPage);
