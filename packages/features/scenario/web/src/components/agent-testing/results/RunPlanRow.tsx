/**
 * One row of the Test Runs list: what the plan is, what it holds, how its
 * last run went, and the menu of what can be done with it.
 *
 * The plan name is its own control and the row menu is a sibling of it, so a
 * keypress reaches the one it is aimed at.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Badge, Box, Button, chakra, HStack, Text } from "@chakra-ui/react";
import { Folder, FolderCode, MoreVertical, Zap } from "lucide-react";
import { RunMetricsSummary } from "@langwatch/suite-web";
import { Menu } from "@langwatch/design-system/menu";
import { useNow } from "../../../hooks/useNow";
import { formatTimeAgoCompact } from "@langwatch/workflow-web/utils/formatTimeAgo";
import { FG_MUTED, ROW_HOVER_BG } from "../shared/design";
import { planScopeNote, type RunPlan, toRunGroupSummary } from "./run-plans";

/**
 * The columns of the list. The prototype carries a count of runs in the
 * window after the result; the plan queries only read the last run, so that
 * place holds the row menu instead. The whole row opens the plan, so it ends
 * on the menu rather than on a chevron.
 */
export const PLAN_COLUMNS = "minmax(0,1fr) 60px 58px minmax(0,560px) 32px";

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
      <Text fontSize="11px" color={FG_MUTED}>
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
export function PlanRow({
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
            <chakra.button
              type="button"
              minWidth={0}
              textAlign="left"
              cursor="pointer"
              onClick={(event) => {
                event.stopPropagation();
                onSelectPlan(plan.slug);
              }}
              data-testid={`run-plan-open-${plan.slug}`}
            >
              <Text fontSize="12.5px" fontWeight="medium" color="fg" truncate>
                {plan.name}
              </Text>
            </chakra.button>
            <PlanBadge kind={plan.kind} />
          </HStack>
          <Text fontSize="10.5px" color={FG_MUTED} truncate>
            {planScopeNote(plan.kind)}
          </Text>
        </Box>
      </HStack>

      <Text fontSize="12px" color={FG_MUTED}>
        {plan.caseCount ?? "-"}
      </Text>

      <Text fontSize="10.5px" color={FG_MUTED} whiteSpace="nowrap">
        {plan.lastRun?.lastRunTimestamp
          ? formatTimeAgoCompact(plan.lastRun.lastRunTimestamp, now)
          : ""}
      </Text>

      <HStack gap={1.5} flexWrap="wrap" minWidth={0}>
        <LastResultCell plan={plan} days={days} />
      </HStack>

      <HStack justify="flex-end" onClick={(event) => event.stopPropagation()}>
        <PlanRowMenu
          plan={plan}
          onOpenLastRun={() => onSelectPlan(plan.slug)}
          onEditPlan={onEditPlan}
        />
      </HStack>
    </Box>
  );
}
