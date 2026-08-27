/**
 * The Scenario and Target groupings: one row per scenario, or per target, that
 * opens to show every run behind it.
 *
 * Scenario answers "when did this scenario last fail", which needs every run
 * of it across every plan, not the runs of one plan. Target answers "how is
 * dev doing against prod", which needs the same list cut the other way. Both
 * read the same rows, so the two answers can never disagree.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight, Target } from "lucide-react";
import { useNow } from "~/hooks/useNow";
import type { ResultGroup } from "~/server/app-layer/simulations/result-atoms/atom.types";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { FG_MUTED, GROUP_HEADER_BG, ROW_HOVER_BG } from "../shared/design";
import { PassRateText } from "../shared/PassRateText";
import { passRateColor } from "../shared/pass-rate-color";
import { TrendSparkline } from "../shared/TrendSparkline";
import {
  ResultsTableBody,
  ResultsTableCard,
  ResultsTableEmptyLine,
  ResultsTableHead,
  ResultsTableRow,
  ResultsTableTruncationLine,
} from "./ResultsTableChrome";
import type { ResultRow } from "./result-atoms";

const GROUP_COLUMNS =
  "20px minmax(0,1fr) minmax(120px,190px) 70px 78px minmax(100px,110px)";

/** How many runs an opened row lists before it says there are more. */
const EXPANDED_RUN_LIMIT = 40;

/** How a single execution ended, in words and colour. */
function Verdict({ row }: { row: ResultRow }) {
  const text =
    row.outcome === "passed"
      ? "Passed"
      : row.outcome === "failed"
        ? "Failed"
        : "Running";
  const passRate =
    row.outcome === "passed" ? 100 : row.outcome === "failed" ? 0 : null;

  return (
    <Text
      as="span"
      fontSize="11.5px"
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
      paddingLeft={11}
      cursor="pointer"
      _hover={{ background: ROW_HOVER_BG }}
      onClick={() => onOpenRun(row)}
      data-testid={`results-run-line-${row.executionId}`}
    >
      <Text
        flex={1}
        minWidth={0}
        fontSize="12px"
        fontWeight="medium"
        color="fg"
        truncate
      >
        {show === "plan" ? row.planName : row.scenarioName}
      </Text>
      <Text
        width="200px"
        flexShrink={0}
        fontSize="11.5px"
        color={FG_MUTED}
        truncate
      >
        {resolveTargetName(row.targetKey)}
      </Text>
      <Text
        width="70px"
        flexShrink={0}
        fontSize="11px"
        color={FG_MUTED}
        whiteSpace="nowrap"
      >
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
  return group.scenarioCount === 1
    ? "1 scenario"
    : `${group.scenarioCount} scenarios`;
}

/** The line a group always draws, open or folded. */
function GroupSummaryRow({
  group,
  isScenario,
  isOpen,
  onToggleOpen,
}: {
  group: ResultGroup;
  isScenario: boolean;
  isOpen: boolean;
  onToggleOpen: (key: string) => void;
}) {
  return (
    <ResultsTableRow
      columns={GROUP_COLUMNS}
      onClick={() => onToggleOpen(group.key)}
      testId={`results-group-row-${group.key}`}
    >
      <Box color={FG_MUTED} display="flex" alignItems="center">
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </Box>

      <HStack gap={1.5} minWidth={0}>
        {!isScenario ? (
          <Box color={FG_MUTED} flexShrink={0} display="flex">
            <Target size={13} />
          </Box>
        ) : null}
        <Text fontSize="12.5px" fontWeight="medium" color="fg" truncate>
          {group.title}
        </Text>
      </HStack>

      <Text fontSize="11.5px" color={FG_MUTED} truncate>
        {middleColumnText({ group, isScenario })}
      </Text>

      <Text
        fontSize="12px"
        color={FG_MUTED}
        textAlign="right"
        fontVariantNumeric="tabular-nums"
      >
        {group.runCount}
      </Text>

      <PassRateText passRate={group.passRate} />

      <TrendSparkline bars={group.trend} per="execution" />
    </ResultsTableRow>
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
  const ordered = [...rows].sort((a, b) => b.runAt - a.runAt);

  return (
    <VStack
      align="stretch"
      gap={0}
      paddingY={1}
      borderTopWidth="1px"
      borderTopColor="border.muted"
      background={GROUP_HEADER_BG}
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
        <Text fontSize="11px" color={FG_MUTED} paddingX={4} paddingY={1.5}>
          {ordered.length - EXPANDED_RUN_LIMIT} older runs are not listed.
          Narrow the period to see them.
        </Text>
      ) : null}
      {ordered.length === 0 ? (
        <Text fontSize="11px" color={FG_MUTED} paddingX={4} paddingY={1.5}>
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
   *
   * A folded row carries no runs of its own: opening it is what asks for
   * them, so a row that is open and not yet answered holds no entry here.
   */
  rowsByGroupKey: Map<string, ResultRow[]>;
  resolveTargetName: (targetKey: string) => string;
  onOpenRun: (row: ResultRow) => void;
};

export function GroupedRowsTable({
  kind,
  groups,
  openedKeys,
  onToggleOpen,
  rowsByGroupKey,
  resolveTargetName,
  onOpenRun,
}: GroupedRowsTableProps) {
  const now = useNow();
  const isScenario = kind === "scenario";

  return (
    <ResultsTableCard testId={`agent-testing-results-by-${kind}`}>
      <ResultsTableHead
        columns={GROUP_COLUMNS}
        headings={[
          { key: "chevron", text: "" },
          { key: "title", text: isScenario ? "Scenario" : "Target" },
          {
            key: "middle",
            text: isScenario ? "Labels" : "Scenarios covered",
          },
          { key: "runs", text: "Runs", align: "right" },
          { key: "pass", text: "Pass", align: "right" },
          { key: "trend", text: "Trend" },
        ]}
      />

      <ResultsTableBody>
        {groups.map((group) => (
          <Box key={group.key}>
            <GroupSummaryRow
              group={group}
              isScenario={isScenario}
              isOpen={openedKeys.includes(group.key)}
              onToggleOpen={onToggleOpen}
            />

            {openedKeys.includes(group.key) ? (
              <GroupRunList
                group={group}
                rows={rowsByGroupKey.get(group.key) ?? []}
                show={isScenario ? "plan" : "scenario"}
                resolveTargetName={resolveTargetName}
                onOpenRun={onOpenRun}
                now={now}
              />
            ) : null}
          </Box>
        ))}

        {groups.length === 0 ? (
          <ResultsTableEmptyLine text="No runs match these filters." />
        ) : null}
      </ResultsTableBody>
    </ResultsTableCard>
  );
}

/** How many rows the flat list draws before it says there are more. */
export const FLAT_ROW_LIMIT = 300;

const FLAT_COLUMNS =
  "minmax(0,1.3fr) minmax(0,1fr) minmax(150px,205px) 80px 92px";

export type FlatRowsTableProps = {
  rows: ResultRow[];
  resolveTargetName: (targetKey: string) => string;
  onOpenRun: (row: ResultRow) => void;
  /** True while more rows exist on the server than were loaded. */
  hasMore: boolean;
};

/**
 * The None grouping: one row per scenario, target and run.
 *
 * The flat list is for when a filter has already narrowed the question, so it
 * is capped and says when it has been. A list that quietly stops at its cap
 * reads as the whole answer.
 */
export function FlatRowsTable({
  rows,
  resolveTargetName,
  onOpenRun,
  hasMore,
}: FlatRowsTableProps) {
  const now = useNow();
  const ordered = [...rows].sort((a, b) => b.runAt - a.runAt);
  const drawn = ordered.slice(0, FLAT_ROW_LIMIT);
  const isCut = hasMore || ordered.length > FLAT_ROW_LIMIT;

  return (
    <ResultsTableCard testId="agent-testing-results-flat">
      <ResultsTableHead
        columns={FLAT_COLUMNS}
        headings={[
          { key: "scenario", text: "Scenario" },
          { key: "plan", text: "Run plan" },
          { key: "target", text: "Target" },
          { key: "when", text: "When" },
          { key: "result", text: "Result" },
        ]}
      />

      <ResultsTableBody>
        {drawn.map((row) => (
          <ResultsTableRow
            key={row.executionId}
            columns={FLAT_COLUMNS}
            paddingY="8px"
            onClick={() => onOpenRun(row)}
            testId={`results-flat-row-${row.executionId}`}
          >
            <Text fontSize="12.5px" fontWeight="medium" color="fg" truncate>
              {row.scenarioName}
            </Text>
            <Text fontSize="11.5px" color={FG_MUTED} truncate>
              {row.planName}
            </Text>
            <Text fontSize="11.5px" color={FG_MUTED} truncate>
              {resolveTargetName(row.targetKey)}
            </Text>
            <Text fontSize="11.5px" color={FG_MUTED} whiteSpace="nowrap">
              {formatTimeAgoCompact(row.runAt, now)}
            </Text>
            <Verdict row={row} />
          </ResultsTableRow>
        ))}

        {drawn.length === 0 ? (
          <ResultsTableEmptyLine text="No runs match these filters." />
        ) : null}
      </ResultsTableBody>

      {isCut && drawn.length > 0 ? (
        <ResultsTableTruncationLine
          text={`Showing the newest ${drawn.length} runs. Add a filter or narrow the period to see the rest.`}
        />
      ) : null}
    </ResultsTableCard>
  );
}
