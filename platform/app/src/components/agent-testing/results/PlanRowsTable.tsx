/**
 * The Run plan grouping: one row per plan, with what it covers, how it went
 * and how it has been going.
 *
 * A plan that did not run inside the window still has a row. Someone who opens
 * this page to check on a plan they are worried about is exactly the person
 * whose plan has gone quiet, so a quiet plan must be visible rather than
 * missing.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Badge, Box, Button, HStack, Icon, Text } from "@chakra-ui/react";
import { Archive, MoreVertical } from "lucide-react";
import { useState } from "react";
import { SuiteArchiveDialog } from "~/components/suites/SuiteArchiveDialog";
import { Menu } from "~/components/ui/menu";
import { useNow } from "~/hooks/useNow";
import type { ResultGroup } from "~/server/app-layer/simulations/result-atoms/atom.types";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { FG_MUTED } from "../shared/design";
import { PassRateText } from "../shared/PassRateText";
import { TrendSparkline } from "../shared/TrendSparkline";
import {
  ResultsTableBody,
  ResultsTableCard,
  ResultsTableEmptyLine,
  ResultsTableHead,
  ResultsTableRow,
} from "./ResultsTableChrome";
import { targetsLabel } from "./result-atoms";
import type { RunPlan } from "./run-plans";

/**
 * The columns of the plan table.
 *
 * Cost and duration are not among them. A boxed pill carrying both read as
 * clutter repeated down a column, and the duration was unavailable on most
 * rows anyway; the totals live in the stat strip, where a total states what it
 * covers.
 */
export const PLAN_COLUMNS =
  "minmax(0,1fr) minmax(140px,170px) minmax(95px,140px) minmax(100px,155px) 60px 100px 32px";

const PLAN_HEADINGS = [
  { key: "plan", text: "Run plan" },
  { key: "last-run", text: "Last run" },
  { key: "scope", text: "Scope" },
  { key: "targets", text: "Targets" },
  { key: "pass", text: "Pass", align: "right" as const },
  { key: "trend", text: "Trend" },
  { key: "menu", text: "" },
];

/** One row of the plan table: a plan, and the runs of it in the window. */
export type PlanRowModel = {
  plan: RunPlan;
  /** Absent while the plan has no run inside the window. */
  group: ResultGroup | null;
};

function PlanBadge({ kind }: { kind: RunPlan["kind"] }) {
  if (kind === "external") {
    return (
      <Badge size="xs" variant="subtle" colorPalette="gray">
        from code
      </Badge>
    );
  }
  return null;
}

/**
 * The Last run cell: how long ago, over how many scenarios, over how many
 * runs. One muted line, because it is context for the name beside it rather
 * than a number anyone compares.
 */
function LastRunCell({
  group,
  days,
  now,
}: {
  group: ResultGroup | null;
  days: number;
  now: number;
}) {
  if (!group || group.lastRunAt === null) {
    return (
      <Text fontSize="11.5px" color={FG_MUTED} truncate>
        nothing in {days} days
      </Text>
    );
  }

  const scenarios =
    group.scenarioCount === 1
      ? "1 scenario"
      : `${group.scenarioCount} scenarios`;
  const runs = group.runCount === 1 ? "1 run" : `${group.runCount} runs`;

  return (
    <Text
      fontSize="11.5px"
      color={FG_MUTED}
      fontVariantNumeric="tabular-nums"
      truncate
      data-testid="plan-last-run"
    >
      {formatTimeAgoCompact(group.lastRunAt, now)} · {scenarios} · {runs}
    </Text>
  );
}

/** What the archive dialog of a run plan asks, and what it promises. */
export const PLAN_ARCHIVE_TITLE = "Archive run plan?";
export const PLAN_ARCHIVE_DESCRIPTION =
  "The plan leaves the list. Its runs are kept.";

/** True while the plan has a run inside the window the table reads. */
function hasRunInPeriod(group: ResultGroup | null): boolean {
  return !!group && group.lastRunAt !== null;
}

function PlanRowMenu({
  plan,
  group,
  onSelectPlan,
  onEditPlan,
  onRequestArchive,
}: {
  plan: RunPlan;
  group: ResultGroup | null;
  onSelectPlan: (planSlug: string) => void;
  onEditPlan: (suiteId: string) => void;
  onRequestArchive: (plan: RunPlan) => void;
}) {
  const suiteId = plan.kind === "suite" ? plan.suiteId : null;
  // A plan with no run in the window has nothing to open, so the item that
  // would land on an empty run is not offered at all.
  const canOpenLastRun = hasRunInPeriod(group);

  if (!canOpenLastRun && !suiteId) return null;

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
        {canOpenLastRun ? (
          <Menu.Item
            value="open-last-run"
            onClick={(event) => {
              event.stopPropagation();
              onSelectPlan(plan.slug);
            }}
          >
            Open last run
          </Menu.Item>
        ) : null}
        {suiteId ? (
          <Menu.Item
            value="edit"
            onClick={(event) => {
              event.stopPropagation();
              onEditPlan(suiteId);
            }}
          >
            Edit run plan
          </Menu.Item>
        ) : null}
        {suiteId ? (
          <Menu.Item
            value="archive"
            color="red.600"
            onClick={(event) => {
              event.stopPropagation();
              onRequestArchive(plan);
            }}
          >
            <HStack gap={2}>
              <Icon as={Archive} boxSize={3.5} />
              Archive run plan
            </HStack>
          </Menu.Item>
        ) : null}
      </Menu.Content>
    </Menu.Root>
  );
}

export type PlanRowsTableProps = {
  rows: PlanRowModel[];
  /** The window, in days, for the row that says nothing ran inside it. */
  days: number;
  resolveTargetName: (targetKey: string) => string;
  onSelectPlan: (planSlug: string) => void;
  onEditPlan: (suiteId: string) => void;
  onArchivePlan: (plan: RunPlan) => void;
  /** True while the archive call is out, so the dialog holds its buttons. */
  isArchiving?: boolean;
};

export function PlanRowsTable({
  rows,
  days,
  resolveTargetName,
  onSelectPlan,
  onEditPlan,
  onArchivePlan,
  isArchiving = false,
}: PlanRowsTableProps) {
  const now = useNow();
  const [planToArchive, setPlanToArchive] = useState<RunPlan | null>(null);

  const confirmArchive = () => {
    if (!planToArchive) return;
    onArchivePlan(planToArchive);
    setPlanToArchive(null);
  };

  return (
    <ResultsTableCard testId="agent-testing-run-plans-table">
      <ResultsTableHead columns={PLAN_COLUMNS} headings={PLAN_HEADINGS} />

      <ResultsTableBody>
        {rows.map(({ plan, group }) => (
          <ResultsTableRow
            key={plan.slug}
            columns={PLAN_COLUMNS}
            onClick={() => onSelectPlan(plan.slug)}
            testId={`run-plan-row-${plan.slug}`}
          >
            <HStack gap={1.5} minWidth={0}>
              <Text fontSize="12.5px" fontWeight="medium" color="fg" truncate>
                {plan.name}
              </Text>
              <PlanBadge kind={plan.kind} />
            </HStack>

            <LastRunCell group={group} days={days} now={now} />

            <Text fontSize="11.5px" color={FG_MUTED} truncate>
              {plan.scopeLabel}
            </Text>

            <Text fontSize="11.5px" color={FG_MUTED} truncate>
              {targetsLabel(
                (group?.targetKeys ?? []).map((key) => resolveTargetName(key)),
              )}
            </Text>

            <PassRateText passRate={group?.passRate ?? null} />

            {/* A plan with no run has no history to draw, and "no runs" here
                would only repeat what the Last run column already says. */}
            {group && group.trend.length > 0 ? (
              <TrendSparkline bars={group.trend} per="run" />
            ) : (
              <Box />
            )}

            <HStack
              justify="flex-end"
              onClick={(event) => event.stopPropagation()}
            >
              <PlanRowMenu
                plan={plan}
                group={group}
                onSelectPlan={onSelectPlan}
                onEditPlan={onEditPlan}
                onRequestArchive={setPlanToArchive}
              />
            </HStack>
          </ResultsTableRow>
        ))}

        {rows.length === 0 ? (
          <ResultsTableEmptyLine text="No run plans match these filters." />
        ) : null}
      </ResultsTableBody>

      <SuiteArchiveDialog
        open={!!planToArchive}
        onClose={() => setPlanToArchive(null)}
        onConfirm={confirmArchive}
        suiteName={planToArchive?.name ?? ""}
        isLoading={isArchiving}
        title={PLAN_ARCHIVE_TITLE}
        description={PLAN_ARCHIVE_DESCRIPTION}
      />
    </ResultsTableCard>
  );
}
