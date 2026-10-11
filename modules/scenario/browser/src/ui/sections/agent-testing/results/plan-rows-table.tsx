/**
 * The Run plan grouping: one row per plan, with what it covers, how it went and how it
 * has been going.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { formatTimeAgoCompact } from "@langwatch/browser-host/format-time-ago";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Button, HStack, Icon, Text } from "@langwatch/design-system/primitives";
import type { ResultGroup } from "@langwatch/scenario-contract";
import { Archive, Crosshair, Folder, FolderCode, Layers, Tag } from "lucide-react";
import { useState } from "react";

import type {
  RunPlan,
  RunPlanScopeKind,
} from "../../../../behavior/agent-testing/results/run-plans.ts";
import { useNow } from "../../../../behavior/use-now.ts";
import type { TargetKind } from "../../../../model/target-kind.ts";
import { FromCodeBadge } from "../../../elements/agent-testing/shared/from-code-badge.tsx";
import { PassRateText } from "../../../elements/agent-testing/shared/pass-rate-text.tsx";
import { TargetMark } from "../../../elements/agent-testing/shared/target-mark.tsx";
import { TrendSparkline } from "../../../elements/agent-testing/shared/trend-sparkline.tsx";
import { SuiteArchiveDialog } from "../../../elements/suite/dialogs/suite-archive-dialog.tsx";
import { targetsLabel } from "./result-atoms.ts";
import {
  type ResultsColumn,
  ResultsTable,
  ResultsTableEmptyLine,
  ResultsTableHead,
} from "./results-table-chrome.tsx";

/**
 * The mark beside what a plan covers. A scope is a rule rather than a list, so the mark
 * says which rule it is: every scenario, a suite, a label, or a hand-picked few. It
 * reads next to words that name the same thing, so it carries no label of its own.
 */
const SCOPE_ICONS: Record<RunPlanScopeKind, typeof Layers> = {
  all: Layers,
  test_suites: Folder,
  labels: Tag,
  scenarios: Crosshair,
  external: FolderCode,
};

/**
 * The targets a plan runs against, behind one mark.
 */
function TargetsCell({
  targetKeys,
  resolveTargetName,
  resolveTargetKind,
}: {
  targetKeys: string[];
  resolveTargetName: (targetKey: string) => string;
  resolveTargetKind: (targetKey: string) => TargetKind;
}) {
  const label = targetsLabel(targetKeys.map((key) => resolveTargetName(key)));
  const first = targetKeys[0];
  const kind: TargetKind = targetKeys.length > 1 || !first ? "several" : resolveTargetKind(first);

  return (
    <HStack gap={1.5} minWidth={0} data-testid="plan-targets">
      {label ? <TargetMark kind={kind} testId="plan-targets-mark" /> : null}
      <Text textStyle="caption" color="fg.muted" truncate>
        {label}
      </Text>
    </HStack>
  );
}

function ScopeCell({ plan }: { plan: RunPlan }) {
  return (
    <HStack gap={1.5} minWidth={0} data-testid="plan-scope">
      <Icon
        as={SCOPE_ICONS[plan.scopeKind]}
        boxSize="13px"
        color="fg.muted"
        flexShrink={0}
        aria-hidden
      />
      <Text textStyle="caption" color="fg.muted" truncate>
        {plan.scopeLabel}
      </Text>
    </HStack>
  );
}

/** The columns of the plan table: the name takes the free width, the row menu the last. */
export const PLAN_COLUMNS: ResultsColumn[] = [
  { key: "plan", text: "Run plan" },
  { key: "last-run", text: "Last run", width: "184px" },
  { key: "scope", text: "Scope", width: "150px" },
  { key: "targets", text: "Targets", width: "164px" },
  { key: "pass", text: "Pass", width: "84px", align: "end" },
  { key: "trend", text: "Trend", width: "124px" },
  { key: "menu", text: "", width: "52px", action: true },
];

/** Under this the table scrolls sideways, so the name keeps room to be read. */
const PLAN_MIN_WIDTH = "940px";

/** One row of the plan table: a plan, and the runs of it in the window. */
export type PlanRowModel = {
  plan: RunPlan;
  /** Absent while the plan has no run inside the window. */
  group: ResultGroup | null;
};

function PlanBadge({ kind }: { kind: RunPlan["kind"] }) {
  if (kind === "external") return <FromCodeBadge />;
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
      <Text textStyle="caption" color="fg.muted" truncate>
        nothing in {days} days
      </Text>
    );
  }

  const scenarios = group.scenarioCount === 1 ? "1 scenario" : `${group.scenarioCount} scenarios`;
  const runs = group.runCount === 1 ? "1 run" : `${group.runCount} runs`;

  return (
    <Text
      textStyle="caption"
      color="fg.muted"
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
export const PLAN_ARCHIVE_DESCRIPTION = "The plan leaves the list. Its runs are kept.";

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
          <MoreVerticalIcon size={14} />
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
            color="red.fg"
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
  /**
   * True while the window holds runs that no row of this table accounts for: a single
   * scenario or a test suite run from the platform belongs to no run plan.
   */
  hasRunsOutsidePlans?: boolean;
  resolveTargetName: (targetKey: string) => string;
  resolveTargetKind: (targetKey: string) => TargetKind;
  onSelectPlan: (planSlug: string) => void;
  onEditPlan: (suiteId: string) => void;
  onArchivePlan: (plan: RunPlan) => void;
  /** True while the archive call is out, so the dialog holds its buttons. */
  isArchiving?: boolean;
  /** Offered in the empty line when filters left no plan to draw. */
  onClearFilters?: () => void;
};

export function PlanRowsTable({
  rows,
  days,
  hasRunsOutsidePlans = false,
  resolveTargetName,
  resolveTargetKind,
  onSelectPlan,
  onEditPlan,
  onArchivePlan,
  isArchiving = false,
  onClearFilters,
}: PlanRowsTableProps) {
  const now = useNow();
  const [planToArchive, setPlanToArchive] = useState<RunPlan | null>(null);

  const confirmArchive = () => {
    if (!planToArchive) return;
    onArchivePlan(planToArchive);
    setPlanToArchive(null);
  };

  return (
    <>
      <ResultsTable
        columns={PLAN_COLUMNS}
        minWidth={PLAN_MIN_WIDTH}
        testId="agent-testing-run-plans-table"
      >
        <ResultsTableHead columns={PLAN_COLUMNS} />

        <ListTable.Body>
          {rows.map(({ plan, group }) => (
            <ListTable.Row
              key={plan.slug}
              onActivate={() => onSelectPlan(plan.slug)}
              data-testid={`run-plan-row-${plan.slug}`}
            >
              <ListTable.Cell>
                <HStack gap={1.5} minWidth={0}>
                  <Text
                    textStyle="bodySm"
                    fontWeight="medium"
                    color="fg"
                    truncate
                    data-testid={`run-plan-name-${plan.name}`}
                  >
                    {plan.name}
                  </Text>
                  <PlanBadge kind={plan.kind} />
                </HStack>
              </ListTable.Cell>

              <ListTable.Cell>
                <LastRunCell group={group} days={days} now={now} />
              </ListTable.Cell>

              <ListTable.Cell>
                <ScopeCell plan={plan} />
              </ListTable.Cell>

              <ListTable.Cell>
                <TargetsCell
                  targetKeys={group?.targetKeys ?? []}
                  resolveTargetName={resolveTargetName}
                  resolveTargetKind={resolveTargetKind}
                />
              </ListTable.Cell>

              <ListTable.Cell align="end">
                <PassRateText passRate={group?.passRate ?? null} />
              </ListTable.Cell>

              {/* A plan with no run has no history to draw, and "no runs" here
                would only repeat what the Last run column already says. */}
              <ListTable.Cell>
                {group && group.trend.length > 0 ? (
                  <TrendSparkline bars={group.trend} per="run" />
                ) : null}
              </ListTable.Cell>

              <ListTable.ActionCell>
                <PlanRowMenu
                  plan={plan}
                  group={group}
                  onSelectPlan={onSelectPlan}
                  onEditPlan={onEditPlan}
                  onRequestArchive={setPlanToArchive}
                />
              </ListTable.ActionCell>
            </ListTable.Row>
          ))}

          {rows.length === 0 && hasRunsOutsidePlans ? (
            <ResultsTableEmptyLine
              columns={PLAN_COLUMNS.length}
              state="empty"
              title="These runs were started outside a run plan"
              description="Group by scenario or target to read them."
            />
          ) : null}
          {rows.length === 0 && !hasRunsOutsidePlans ? (
            <ResultsTableEmptyLine
              columns={PLAN_COLUMNS.length}
              state="no-results"
              title="No run plans match these filters"
              onClearFilters={onClearFilters}
            />
          ) : null}
        </ListTable.Body>
      </ResultsTable>

      <SuiteArchiveDialog
        open={!!planToArchive}
        onClose={() => setPlanToArchive(null)}
        onConfirm={confirmArchive}
        suiteName={planToArchive?.name ?? ""}
        isLoading={isArchiving}
        title={PLAN_ARCHIVE_TITLE}
        description={PLAN_ARCHIVE_DESCRIPTION}
      />
    </>
  );
}
