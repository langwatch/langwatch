/**
 * The Test Runs list: every run plan of the project, what it covers, how many
 * cases it holds and how its last run went.
 *
 * The list is a grid inside one card, the way the Test cases table is drawn,
 * so both tabs read as one surface.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/one-off-runs-surface.feature
 */

import {
  Badge,
  Box,
  Button,
  chakra,
  EmptyState,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  ChevronRight,
  FlaskConical,
  Folder,
  FolderCode,
  MoreVertical,
  Zap,
} from "lucide-react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "~/components/PeriodSelector";
import { RunMetricsSummary } from "~/components/suites/RunMetricsSummary";
import { Menu } from "~/components/ui/menu";
import { useNow } from "~/hooks/useNow";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { ContentColumn } from "../shared/ContentColumn";
import { FG_FAINT, FG_MUTED, ROW_HOVER_BG, TABLE_HEADER_BG } from "../shared/design";
import { AgentTestingPeriodPicker, periodDays } from "../shared/PeriodPicker";
import { planScopeNote, type RunPlan, toRunGroupSummary } from "./run-plans";

/**
 * The columns of the list. The prototype carries a count of runs in the
 * window between the result and the chevron; the plan queries only read the
 * last run, so that place holds the row menu instead.
 */
const PLAN_COLUMNS =
  "minmax(0,1fr) 60px 58px minmax(0,560px) 32px 20px";

export type RunPlansTableProps = {
  plans: RunPlan[];
  isLoading: boolean;
  /** False while the project has nothing that ever ran. */
  hasAnyPlans: boolean;
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
  onSelectPlan: (planSlug: string) => void;
  onEditPlan: (suiteId: string) => void;
};

function PlanIcon({ kind }: { kind: RunPlan["kind"] }) {
  const color = "var(--chakra-colors-fg-muted)";
  if (kind === "external") return <FolderCode size={14} color={color} />;
  if (kind === "one-off") return <Zap size={14} color={color} />;
  return <Folder size={14} color={color} />;
}

function PlanBadge({ kind }: { kind: RunPlan["kind"] }) {
  if (kind === "external") {
    return (
      <Badge size="xs" variant="subtle" colorPalette="gray">
        from code
      </Badge>
    );
  }
  if (kind === "one-off") {
    return (
      <Badge size="xs" variant="subtle" colorPalette="gray">
        one-offs
      </Badge>
    );
  }
  return null;
}

/**
 * How the last run of a plan went.
 *
 * A plan that never ran inside the window says so. A plan whose summary holds
 * no verdict yet says nothing at all: the metrics pill would be an empty grey
 * pill, which reads as a broken row rather than as an absent number.
 */
function LastResultCell({ plan, days }: { plan: RunPlan; days: number }) {
  if (!plan.lastRun || plan.lastRun.lastRunTimestamp === null) {
    return (
      <Text fontSize="11px" color={FG_FAINT}>
        nothing in {days} days
      </Text>
    );
  }

  if (plan.lastRun.settledCount === 0) return null;

  return <RunMetricsSummary summary={toRunGroupSummary(plan.lastRun)} />;
}

function PlanRowMenu({
  plan,
  onOpenLastRun,
  onEditPlan,
}: {
  plan: RunPlan;
  onOpenLastRun: () => void;
  onEditPlan: (suiteId: string) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          minWidth="24px"
          height="24px"
          paddingX={0}
          aria-label={`Actions for ${plan.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="open-last-run"
          onClick={(event) => {
            event.stopPropagation();
            onOpenLastRun();
          }}
        >
          Open last run
        </Menu.Item>
        {plan.kind === "suite" && plan.suiteId ? (
          <Menu.Item
            value="edit"
            onClick={(event) => {
              event.stopPropagation();
              onEditPlan(plan.suiteId!);
            }}
          >
            Edit run plan
          </Menu.Item>
        ) : null}
      </Menu.Content>
    </Menu.Root>
  );
}

/** One row of the list: what the plan is, what it holds and how it went. */
function PlanRow({
  plan,
  days,
  onSelectPlan,
  onEditPlan,
}: {
  plan: RunPlan;
  days: number;
  onSelectPlan: (planSlug: string) => void;
  onEditPlan: (suiteId: string) => void;
}) {
  const now = useNow();

  return (
    <Box
      display="grid"
      gridTemplateColumns={PLAN_COLUMNS}
      columnGap={3}
      alignItems="center"
      paddingX={4}
      paddingY="10px"
      cursor="pointer"
      _hover={{ background: ROW_HOVER_BG }}
      onClick={() => onSelectPlan(plan.slug)}
      data-testid={`run-plan-row-${plan.slug}`}
    >
      <HStack gap={2} minWidth={0}>
        <PlanIcon kind={plan.kind} />
        <Box minWidth={0}>
          <HStack gap={1.5} minWidth={0}>
            <Text fontSize="12.5px" fontWeight="medium" color="fg" truncate>
              {plan.name}
            </Text>
            <PlanBadge kind={plan.kind} />
          </HStack>
          <Text fontSize="10.5px" color={FG_FAINT} truncate>
            {planScopeNote(plan.kind)}
          </Text>
        </Box>
      </HStack>

      <Text fontSize="12px" color={FG_MUTED}>
        {plan.caseCount ?? "-"}
      </Text>

      <Text fontSize="10.5px" color={FG_FAINT} whiteSpace="nowrap">
        {plan.lastRun?.lastRunTimestamp
          ? formatTimeAgoCompact(plan.lastRun.lastRunTimestamp, now)
          : ""}
      </Text>

      <HStack gap={1.5} flexWrap="wrap" minWidth={0}>
        <LastResultCell plan={plan} days={days} />
      </HStack>

      <HStack
        justify="flex-end"
        onClick={(event) => event.stopPropagation()}
      >
        <PlanRowMenu
          plan={plan}
          onOpenLastRun={() => onSelectPlan(plan.slug)}
          onEditPlan={onEditPlan}
        />
      </HStack>

      <ChevronRight size={13} color="var(--chakra-colors-fg-muted)" />
    </Box>
  );
}

export function RunPlansTable({
  plans,
  isLoading,
  hasAnyPlans,
  period,
  setRelativePeriod,
  onSelectPlan,
  onEditPlan,
}: RunPlansTableProps) {
  const days = periodDays(period);

  return (
    <ContentColumn data-testid="agent-testing-run-plans">
      <HStack gap={2} height="32px">
        <Text fontSize="14px" fontWeight="semibold" color="fg">
          Test Runs
        </Text>
        <Text fontSize="11.5px" color={FG_FAINT}>
          {plans.length === 1 ? "1 run plan" : `${plans.length} run plans`}
        </Text>
        <Box flex={1} />
        <AgentTestingPeriodPicker
          period={period}
          setRelativePeriod={setRelativePeriod}
        />
      </HStack>

      {isLoading ? (
        <VStack align="stretch" gap={2}>
          <Skeleton height="44px" />
          <Skeleton height="44px" />
          <Skeleton height="44px" />
        </VStack>
      ) : !hasAnyPlans ? (
        <EmptyState.Root paddingY={12}>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <FlaskConical size={28} />
            </EmptyState.Indicator>
            <EmptyState.Title>No runs yet</EmptyState.Title>
            <EmptyState.Description>
              Run a test suite or a single test case and the results land here.
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      ) : (
        <Box
          borderWidth="1px"
          borderColor="border"
          borderRadius="xl"
          background="bg.panel"
          overflow="hidden"
          boxShadow="0 1px 2px rgb(16 16 32 / 0.04)"
          data-testid="agent-testing-run-plans-table"
        >
          <Box
            display="grid"
            gridTemplateColumns={PLAN_COLUMNS}
            columnGap={3}
            alignItems="center"
            paddingX={4}
            paddingY={2}
            background={TABLE_HEADER_BG}
            borderBottomWidth="1px"
            borderBottomColor="border"
            fontSize="10.5px"
            fontWeight="semibold"
            textTransform="uppercase"
            letterSpacing="0.025em"
            color={FG_FAINT}
          >
            <Text as="span">Run plan</Text>
            <Text as="span">Cases</Text>
            <Text as="span" gridColumn="span 2">
              Last run
            </Text>
            <Text as="span" />
            <Text as="span" />
          </Box>

          <chakra.div
            css={{
              "& > * + *": {
                borderTopWidth: "1px",
                borderTopColor: "var(--chakra-colors-border-muted)",
              },
            }}
          >
            {plans.map((plan) => (
              <PlanRow
                key={plan.slug}
                plan={plan}
                days={days}
                onSelectPlan={onSelectPlan}
                onEditPlan={onEditPlan}
              />
            ))}
          </chakra.div>
        </Box>
      )}
    </ContentColumn>
  );
}
