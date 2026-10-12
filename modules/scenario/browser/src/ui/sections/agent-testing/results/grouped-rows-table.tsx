/**
 * The Scenario and Target groupings: one row per scenario, or per target, that opens to
 * show every run behind it.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { formatTimeAgoCompact } from "@langwatch/browser-host/format-time-ago";
import { ListTable } from "@langwatch/design-system/list-table";
import { Box, chakra, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { ResultGroup } from "@langwatch/scenario-contract";
import { Fragment } from "react";

import { useNow } from "../../../../behavior/use-now.ts";
import type { TargetKind } from "../../../../model/target-kind.ts";
import { FromCodeBadge } from "../../../elements/agent-testing/shared/from-code-badge.tsx";
import { passRateColor } from "../../../elements/agent-testing/shared/pass-rate-color.ts";
import { PassRateText } from "../../../elements/agent-testing/shared/pass-rate-text.tsx";
import { TargetMark } from "../../../elements/agent-testing/shared/target-mark.tsx";
import { TrendSparkline } from "../../../elements/agent-testing/shared/trend-sparkline.tsx";
import type { ResultRow } from "./result-atoms.ts";
import { isCodeTargetKey } from "./result-atoms.ts";
import {
  type ResultsColumn,
  ResultsTable,
  ResultsTableEmptyLine,
  ResultsTableHead,
  ResultsTableTruncationLine,
} from "./results-table-chrome.tsx";

/** The columns of a grouping: the chevron, the title on the free width, then the numbers. */
function groupColumns({ isScenario }: { isScenario: boolean }): ResultsColumn[] {
  return [
    { key: "chevron", text: "", label: "Show runs", width: "48px" },
    { key: "title", text: isScenario ? "Scenario" : "Target" },
    { key: "middle", text: isScenario ? "Labels" : "Scenarios covered", width: "194px" },
    { key: "runs", text: "Runs", width: "94px", align: "end" },
    { key: "pass", text: "Pass", width: "102px", align: "end" },
    { key: "trend", text: "Trend", width: "138px" },
  ];
}

/** Under this a grouping scrolls sideways, so the title keeps room to be read. */
const GROUP_MIN_WIDTH = "776px";

/** The id of the opened row that lists the runs behind a group. */
function runListId(group: ResultGroup): string {
  return `results-group-runs-${group.key}`;
}

/** How many runs an opened row lists before it says there are more. */
const EXPANDED_RUN_LIMIT = 40;

/** How a single execution ended, in words and colour. */
function verdictOf(outcome: ResultRow["outcome"]): { text: string; passRate: number | null } {
  if (outcome === "passed") return { text: "Passed", passRate: 100 };
  if (outcome === "failed") return { text: "Failed", passRate: 0 };
  return { text: "Running", passRate: null };
}

function Verdict({ row }: { row: ResultRow }) {
  const { text, passRate } = verdictOf(row.outcome);

  return (
    <Text
      as="span"
      textStyle="caption"
      fontWeight="semibold"
      whiteSpace="nowrap"
      color={passRateColor(passRate)}
    >
      {text}
    </Text>
  );
}

/** One run inside an opened row. */
function RunLine({
  row,
  show,
  resolveTargetName,
  onOpenRun,
  now,
}: {
  row: ResultRow;
  /** Which name the line leads with, since the other one titles the row. */
  show: "plan" | "scenario";
  resolveTargetName: (targetKey: string) => string;
  onOpenRun: (row: ResultRow) => void;
  now: number;
}) {
  return (
    <chakra.button
      type="button"
      display="flex"
      alignItems="center"
      gap={3}
      width="full"
      textAlign="left"
      paddingY={1.5}
      paddingRight={4}
      paddingLeft={15}
      cursor="pointer"
      _hover={{ background: "bg.muted/40" }}
      onClick={() => onOpenRun(row)}
      data-testid={`results-run-line-${row.executionId}`}
    >
      <Text flex={1} minWidth={0} textStyle="caption" fontWeight="medium" color="fg" truncate>
        {show === "plan" ? row.planName : row.scenarioName}
      </Text>
      <Text width="200px" flexShrink={0} textStyle="caption" color="fg.muted" truncate>
        {resolveTargetName(row.targetKey)}
      </Text>
      <Text width="70px" flexShrink={0} textStyle="micro" color="fg.muted" whiteSpace="nowrap">
        {formatTimeAgoCompact(row.runAt, now)}
      </Text>
      <Box width="76px" flexShrink={0}>
        <Verdict row={row} />
      </Box>
    </chakra.button>
  );
}

/** The middle column: a scenario's labels, or how many scenarios a target covers. */
function middleColumnText({
  group,
  isScenario,
}: {
  group: ResultGroup;
  isScenario: boolean;
}): string {
  if (isScenario) return group.subtitle ?? "";
  return group.scenarioCount === 1 ? "1 scenario" : `${group.scenarioCount} scenarios`;
}

/** The line a group always draws, open or folded. */
function GroupSummaryRow({
  group,
  isScenario,
  isOpen,
  onToggleOpen,
  resolveTargetName,
  resolveTargetKind,
}: {
  group: ResultGroup;
  isScenario: boolean;
  isOpen: boolean;
  onToggleOpen: (key: string) => void;
  resolveTargetName: (targetKey: string) => string;
  resolveTargetKind: (targetKey: string) => TargetKind;
}) {
  // A target group is keyed by a reference id, and the read leaves naming it
  // to the client, which holds the names of the agents and the prompts.
  const title = isScenario ? group.title : resolveTargetName(group.key);
  const isCodeTarget = !isScenario && isCodeTargetKey({ targetKey: group.key });
  return (
    <ListTable.Row
      expanded={isOpen}
      onActivate={() => onToggleOpen(group.key)}
      data-testid={`results-group-row-${group.key}`}
    >
      <ListTable.ExpandCell
        expanded={isOpen}
        onToggle={() => onToggleOpen(group.key)}
        label={`Show runs for ${title}`}
        panelId={runListId(group)}
      />

      <ListTable.Cell>
        <HStack gap={1.5} minWidth={0}>
          {!isScenario ? (
            <TargetMark
              kind={resolveTargetKind(group.key)}
              testId={`results-group-target-mark-${group.key}`}
            />
          ) : null}
          <Text textStyle="bodySm" fontWeight="medium" color="fg" truncate>
            {title}
          </Text>
          {isCodeTarget ? <FromCodeBadge /> : null}
        </HStack>
      </ListTable.Cell>

      <ListTable.Cell>
        <Text textStyle="caption" color="fg.muted" truncate>
          {middleColumnText({ group, isScenario })}
        </Text>
      </ListTable.Cell>

      <ListTable.Cell align="end">
        <Text textStyle="caption" color="fg.muted" fontVariantNumeric="tabular-nums">
          {group.runCount}
        </Text>
      </ListTable.Cell>

      <ListTable.Cell align="end">
        <PassRateText passRate={group.passRate} />
      </ListTable.Cell>

      <ListTable.Cell>
        <TrendSparkline bars={group.trend} per="execution" />
      </ListTable.Cell>
    </ListTable.Row>
  );
}

/** The runs behind an opened group, newest first and capped. */
function GroupRunList({
  group,
  rows,
  show,
  resolveTargetName,
  onOpenRun,
  now,
}: {
  group: ResultGroup;
  rows: ResultRow[];
  show: "plan" | "scenario";
  resolveTargetName: (targetKey: string) => string;
  onOpenRun: (row: ResultRow) => void;
  now: number;
}) {
  const ordered = [...rows].toSorted((a, b) => b.runAt - a.runAt);

  return (
    <VStack
      align="stretch"
      gap={0}
      paddingY={1}
      background="bg.muted/30"
      data-testid={`results-group-expanded-${group.key}`}
    >
      {ordered.slice(0, EXPANDED_RUN_LIMIT).map((row) => (
        <RunLine
          key={row.executionId}
          row={row}
          show={show}
          resolveTargetName={resolveTargetName}
          onOpenRun={onOpenRun}
          now={now}
        />
      ))}
      {ordered.length > EXPANDED_RUN_LIMIT ? (
        <Text textStyle="micro" color="fg.muted" paddingX={4} paddingY={1.5}>
          {ordered.length - EXPANDED_RUN_LIMIT} older runs are not listed. Narrow the period to see
          them.
        </Text>
      ) : null}
      {ordered.length === 0 ? (
        <Text textStyle="micro" color="fg.muted" paddingX={4} paddingY={1.5}>
          The runs behind this row are still loading.
        </Text>
      ) : null}
    </VStack>
  );
}

export type GroupedRowsTableProps = {
  kind: "scenario" | "target";
  groups: ResultGroup[];
  openedKeys: string[];
  onToggleOpen: (key: string) => void;
  /**
   * The runs behind each opened row, keyed by that row's key.
   */
  rowsByGroupKey: Map<string, ResultRow[]>;
  resolveTargetName: (targetKey: string) => string;
  resolveTargetKind: (targetKey: string) => TargetKind;
  onOpenRun: (row: ResultRow) => void;
  /** Offered in the empty line when filters left nothing to draw. */
  onClearFilters?: () => void;
};

export function GroupedRowsTable({
  kind,
  groups,
  openedKeys,
  onToggleOpen,
  rowsByGroupKey,
  resolveTargetName,
  resolveTargetKind,
  onOpenRun,
  onClearFilters,
}: GroupedRowsTableProps) {
  const now = useNow();
  const isScenario = kind === "scenario";
  const columns = groupColumns({ isScenario });

  return (
    <ResultsTable
      columns={columns}
      minWidth={GROUP_MIN_WIDTH}
      testId={`agent-testing-results-by-${kind}`}
    >
      <ResultsTableHead columns={columns} />

      <ListTable.Body>
        {groups.map((group) => (
          <Fragment key={group.key}>
            <GroupSummaryRow
              group={group}
              isScenario={isScenario}
              isOpen={openedKeys.includes(group.key)}
              onToggleOpen={onToggleOpen}
              resolveTargetName={resolveTargetName}
              resolveTargetKind={resolveTargetKind}
            />
            {openedKeys.includes(group.key) ? (
              <ListTable.SpanRow columns={columns.length} id={runListId(group)}>
                <GroupRunList
                  group={group}
                  rows={rowsByGroupKey.get(group.key) ?? []}
                  show={isScenario ? "plan" : "scenario"}
                  resolveTargetName={resolveTargetName}
                  onOpenRun={onOpenRun}
                  now={now}
                />
              </ListTable.SpanRow>
            ) : null}
          </Fragment>
        ))}

        {groups.length === 0 ? (
          <ResultsTableEmptyLine
            columns={columns.length}
            state="no-results"
            title="No runs match these filters"
            onClearFilters={onClearFilters}
          />
        ) : null}
      </ListTable.Body>
    </ResultsTable>
  );
}

/** How many rows the flat list draws before it says there are more. */
export const FLAT_ROW_LIMIT = 300;

/** The columns of the flat list: the scenario and the run plan share the free width. */
const FLAT_COLUMNS: ResultsColumn[] = [
  { key: "scenario", text: "Scenario" },
  { key: "plan", text: "Run plan" },
  { key: "target", text: "Target", width: "200px" },
  { key: "when", text: "When", width: "104px" },
  { key: "result", text: "Result", width: "120px" },
];

/** Under this the flat list scrolls sideways, so both names keep room to be read. */
const FLAT_MIN_WIDTH = "664px";

export type FlatRowsTableProps = {
  rows: ResultRow[];
  resolveTargetName: (targetKey: string) => string;
  onOpenRun: (row: ResultRow) => void;
  /** True while more rows exist on the server than were loaded. */
  hasMore: boolean;
  /** Offered in the empty line when filters left nothing to draw. */
  onClearFilters?: () => void;
};

/**
 * The None grouping: one row per scenario, target and run.
 */
export function FlatRowsTable({
  rows,
  resolveTargetName,
  onOpenRun,
  hasMore,
  onClearFilters,
}: FlatRowsTableProps) {
  const now = useNow();
  const ordered = [...rows].toSorted((a, b) => b.runAt - a.runAt);
  const drawn = ordered.slice(0, FLAT_ROW_LIMIT);
  const isCut = hasMore || ordered.length > FLAT_ROW_LIMIT;

  return (
    <ResultsTable
      columns={FLAT_COLUMNS}
      minWidth={FLAT_MIN_WIDTH}
      testId="agent-testing-results-flat"
    >
      <ResultsTableHead columns={FLAT_COLUMNS} />

      <ListTable.Body>
        {drawn.map((row) => (
          <ListTable.Row
            key={row.executionId}
            onActivate={() => onOpenRun(row)}
            data-testid={`results-flat-row-${row.executionId}`}
          >
            <ListTable.Cell>
              <Text textStyle="bodySm" fontWeight="medium" color="fg" truncate>
                {row.scenarioName}
              </Text>
            </ListTable.Cell>
            <ListTable.Cell>
              <Text textStyle="caption" color="fg.muted" truncate>
                {row.planName}
              </Text>
            </ListTable.Cell>
            <ListTable.Cell>
              <Text textStyle="caption" color="fg.muted" truncate>
                {resolveTargetName(row.targetKey)}
              </Text>
            </ListTable.Cell>
            <ListTable.Cell>
              <Text textStyle="caption" color="fg.muted" whiteSpace="nowrap">
                {formatTimeAgoCompact(row.runAt, now)}
              </Text>
            </ListTable.Cell>
            <ListTable.Cell>
              <Verdict row={row} />
            </ListTable.Cell>
          </ListTable.Row>
        ))}

        {drawn.length === 0 ? (
          <ResultsTableEmptyLine
            columns={FLAT_COLUMNS.length}
            state="no-results"
            title="No runs match these filters"
            onClearFilters={onClearFilters}
          />
        ) : null}

        {isCut && drawn.length > 0 ? (
          <ResultsTableTruncationLine
            columns={FLAT_COLUMNS.length}
            text={`Showing the newest ${drawn.length} runs. Add a filter or narrow the period to see the rest.`}
          />
        ) : null}
      </ListTable.Body>
    </ResultsTable>
  );
}
