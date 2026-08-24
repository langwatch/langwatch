/**
 * The Test Runs list: every run plan of the project, with how its last run
 * went and how long ago it was.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/one-off-runs-surface.feature
 */

import {
  Badge,
  Box,
  Button,
  EmptyState,
  HStack,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
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
import { PeriodSelector } from "~/components/PeriodSelector";
import { RunMetricsSummary } from "~/components/suites/RunMetricsSummary";
import { RunSummaryCounts } from "~/components/suites/RunSummaryCounts";
import { ListTable } from "~/components/ui/ListTable";
import { Menu } from "~/components/ui/menu";
import { useNow } from "~/hooks/useNow";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { type RunPlan, toRunGroupSummary } from "./run-plans";

export type RunPlansTableProps = {
  plans: RunPlan[];
  isLoading: boolean;
  /** False while the project has nothing that ever ran. */
  hasAnyRuns: boolean;
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

function LastResultCell({ plan }: { plan: RunPlan }) {
  if (!plan.lastRun || plan.lastRun.lastRunTimestamp === null) {
    return (
      <Text fontSize="xs" color="fg.muted">
        No run in this period
      </Text>
    );
  }

  const summary = toRunGroupSummary(plan.lastRun);
  return (
    <HStack gap={2} flexWrap="wrap">
      <RunMetricsSummary summary={summary} />
      <RunSummaryCounts summary={summary} />
    </HStack>
  );
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

export function RunPlansTable({
  plans,
  isLoading,
  hasAnyRuns,
  period,
  periodMode,
  setPeriod,
  setRelativePeriod,
  onSelectPlan,
  onEditPlan,
}: RunPlansTableProps) {
  const now = useNow();

  return (
    <VStack
      align="stretch"
      gap={3}
      width="full"
      height="full"
      overflow="auto"
      padding={6}
      data-testid="agent-testing-run-plans"
    >
      <HStack gap={2}>
        <Text fontSize="sm" fontWeight="semibold">
          Test Runs
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {plans.length === 1 ? "1 run plan" : `${plans.length} run plans`}
        </Text>
        <Box flex={1} />
        <PeriodSelector
          period={period}
          mode={periodMode}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
          size="xs"
        />
      </HStack>

      {isLoading ? (
        <VStack align="stretch" gap={2}>
          <Skeleton height="44px" />
          <Skeleton height="44px" />
          <Skeleton height="44px" />
        </VStack>
      ) : !hasAnyRuns ? (
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
        <ListTable size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Run plan</Table.ColumnHeader>
              <Table.ColumnHeader width="80px">Cases</Table.ColumnHeader>
              <Table.ColumnHeader width="110px">Last run</Table.ColumnHeader>
              <Table.ColumnHeader>Last result</Table.ColumnHeader>
              <Table.ColumnHeader width="52px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {plans.map((plan) => (
              <Table.Row
                key={plan.slug}
                cursor="pointer"
                _hover={{ background: "bg.muted" }}
                onClick={() => onSelectPlan(plan.slug)}
                data-testid={`run-plan-row-${plan.slug}`}
              >
                <Table.Cell>
                  <HStack gap={2} minWidth={0}>
                    <PlanIcon kind={plan.kind} />
                    <Text fontSize="sm" fontWeight="medium" truncate>
                      {plan.name}
                    </Text>
                    <PlanBadge kind={plan.kind} />
                  </HStack>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="sm" color="fg.muted">
                    {plan.caseCount ?? "-"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                    {plan.lastRun?.lastRunTimestamp
                      ? formatTimeAgoCompact(plan.lastRun.lastRunTimestamp, now)
                      : ""}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <LastResultCell plan={plan} />
                </Table.Cell>
                <Table.Cell textAlign="right">
                  <PlanRowMenu
                    plan={plan}
                    onOpenLastRun={() => onSelectPlan(plan.slug)}
                    onEditPlan={onEditPlan}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </ListTable>
      )}
    </VStack>
  );
}
