/**
 * The Test Runs list: every run plan of the project, what it covers, how many
 * cases it holds and how its last run went.
 *
 * The list is a grid inside one card, the way the Test cases table is drawn,
 * so both tabs read as one surface. Its section header carries New run plan
 * and the period picker, the way the cases panel header carries its actions.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/one-off-runs-surface.feature
 */

import {
  Box,
  chakra,
  EmptyState,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { FlaskConical, Plus } from "lucide-react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "~/components/PeriodSelector";
import { ContentColumn } from "../shared/ContentColumn";
import { FG_MUTED, TABLE_HEADER_BG } from "../shared/design";
import { AgentTestingPeriodPicker, periodDays } from "../shared/PeriodPicker";
import { SmallButton } from "../shared/SmallButton";
import { PLAN_COLUMNS, PlanRow } from "./RunPlanRow";
import type { RunPlan } from "./run-plans";

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
  /** Opens the run plan editor on an empty plan. */
  onNewRunPlan: () => void;
};

export function RunPlansTable({
  plans,
  isLoading,
  hasAnyPlans,
  period,
  setRelativePeriod,
  onSelectPlan,
  onEditPlan,
  onNewRunPlan,
}: RunPlansTableProps) {
  const days = periodDays(period);

  return (
    <ContentColumn data-testid="agent-testing-run-plans">
      <HStack gap={2} height="32px">
        <Text fontSize="14px" fontWeight="semibold" color="fg">
          Test Runs
        </Text>
        <Text fontSize="11.5px" color={FG_MUTED}>
          {plans.length === 1 ? "1 run plan" : `${plans.length} run plans`}
        </Text>
        <Box flex={1} />
        <SmallButton onClick={onNewRunPlan}>
          <Plus size={13} />
          New run plan
        </SmallButton>
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
            color={FG_MUTED}
          >
            <Text as="span">Run plan</Text>
            <Text as="span">Cases</Text>
            <Text as="span" gridColumn="span 2">
              Last run
            </Text>
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
