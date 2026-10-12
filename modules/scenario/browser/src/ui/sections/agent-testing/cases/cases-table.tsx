/**
 * The table of scenarios of the open suite: name and labels, with a Run
 * button and a row menu at the end of every row.
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/scenarios/scenario-test-suite-assignment.feature
 */

import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Button, chakra, HStack, Text } from "@langwatch/design-system/primitives";
import type { ScenarioLastResultSummary } from "@langwatch/scenario-contract";
import { format } from "@langwatch/time";

import { type TestCase } from "../../../../model/agent-testing/cases/test-cases.ts";
import type { Period } from "../../../../model/analytics/period.ts";
import { RunCaseButton } from "../../../elements/agent-testing/cases/run-case-button.tsx";
import { TagList } from "../../../elements/tag-list.tsx";
import { MenuActionLabel } from "./menu-action-label.tsx";
import { RecentRunsSubmenu } from "./recent-runs-menu.tsx";

/** The last result of a scenario, as the aggregate answers it. */
export type CaseLastResult = ScenarioLastResultSummary;

type CaseColumn = { key: string; width?: `${number}px` };

/**
 * The columns of the table: the scenario name takes the free width, the row actions what
 * they need on the right (a Run button only for someone who may run). Selection mode adds
 * a checkbox column at the start. A width holds the cell padding as well as the content.
 */
function caseColumns({
  isSelectionMode,
  canManage,
}: {
  isSelectionMode: boolean;
  canManage: boolean;
}): CaseColumn[] {
  return [
    ...(isSelectionMode ? [{ key: "select", width: "52px" } satisfies CaseColumn] : []),
    { key: "scenario" },
    { key: "actions", width: canManage ? "124px" : "52px" } satisfies CaseColumn,
  ];
}

/** A set that runs from code has no controls, and a last run column instead. */
const EXTERNAL_LAST_RUN_WIDTH = "138px";

/** The table, laid out by its columns so a long name truncates rather than widening it. */
function CasesListTable({
  columns,
  testId,
  children,
}: {
  columns: CaseColumn[];
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <ListTable tableLayout="fixed" data-testid={testId}>
      <ListTable.ColumnGroup>
        {columns.map((column) => (
          <ListTable.Column key={column.key} width={column.width} data-column={column.key} />
        ))}
      </ListTable.ColumnGroup>
      {children}
    </ListTable>
  );
}

export type CasesTableProps = {
  /** The scenarios of the open suite, in order. */
  cases: TestCase[];
  canManage: boolean;
  /** The window the recent runs of a row are read over. */
  period: Period;
  /** True when the table shows checkboxes for a bulk move-to-suite. */
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  hasLastRunByCase: (scenarioId: string) => boolean;
  onToggleSelected: (scenarioId: string) => void;
  /** Enters selection mode with this row pre-checked. */
  onStartMoveToSuite: (scenarioId: string) => void;
  onRowClick: (testCase: TestCase) => void;
  /** Opens the run dialog for the scenario. */
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
};

export function CasesTable({
  cases,
  canManage,
  period,
  isSelectionMode,
  selectedIds,
  hasLastRunByCase,
  onToggleSelected,
  onStartMoveToSuite,
  onRowClick,
  onRunCase,
  onEdit,
  onDuplicate,
  onArchive,
}: CasesTableProps) {
  const columns = caseColumns({ isSelectionMode, canManage });

  return (
    <CasesListTable columns={columns} testId="agent-testing-cases-table">
      <ListTable.Header>
        <ListTable.Row>
          {isSelectionMode && <ListTable.ColumnHeader label="Select" />}
          <ListTable.ColumnHeader>Scenario</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>

      <ListTable.Body>
        {cases.map((testCase) => (
          <CaseRow
            key={testCase.id}
            testCase={testCase}
            canManage={canManage}
            period={period}
            hasLastRun={hasLastRunByCase(testCase.id)}
            isSelectionMode={isSelectionMode}
            isSelected={selectedIds.has(testCase.id)}
            onToggleSelected={onToggleSelected}
            onStartMoveToSuite={onStartMoveToSuite}
            onRowClick={onRowClick}
            onRunCase={onRunCase}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onArchive={onArchive}
          />
        ))}
      </ListTable.Body>
    </CasesListTable>
  );
}

function CaseRow({
  testCase,
  canManage,
  period,
  hasLastRun,
  isSelectionMode,
  isSelected,
  onToggleSelected,
  onStartMoveToSuite,
  onRowClick,
  onRunCase,
  onEdit,
  onDuplicate,
  onArchive,
}: {
  testCase: TestCase;
  canManage: boolean;
  period: Period;
  hasLastRun: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelected: (scenarioId: string) => void;
  onStartMoveToSuite: (scenarioId: string) => void;
  onRowClick: (testCase: TestCase) => void;
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
}) {
  const handleRowClick = () => {
    if (isSelectionMode) {
      onToggleSelected(testCase.id);
      return;
    }
    onRowClick(testCase);
  };

  return (
    <ListTable.Row
      selected={isSelectionMode && isSelected}
      onActivate={handleRowClick}
      data-testid={`case-row-${testCase.name}`}
    >
      {isSelectionMode && (
        <ListTable.SelectCell
          label={`Select ${testCase.name}`}
          checked={isSelected}
          onCheckedChange={() => onToggleSelected(testCase.id)}
        />
      )}
      <ListTable.Cell>
        <HStack gap={1.5} minWidth={0} flexWrap="wrap">
          <chakra.button
            type="button"
            minWidth={0}
            maxWidth="full"
            textAlign="left"
            cursor="pointer"
            onClick={(event) => {
              event.stopPropagation();
              onRowClick(testCase);
            }}
          >
            <Text textStyle="bodySm" fontWeight="medium" color="fg" truncate>
              {testCase.name}
            </Text>
          </chakra.button>
          <TagList labels={testCase.labels} tone="pastel" />
        </HStack>
      </ListTable.Cell>

      <CaseRowActions
        testCase={testCase}
        canManage={canManage}
        period={period}
        hasLastRun={hasLastRun}
        onRunCase={onRunCase}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onStartMoveToSuite={onStartMoveToSuite}
        onArchive={onArchive}
      />
    </ListTable.Row>
  );
}

function CaseRowActions({
  testCase,
  canManage,
  period,
  hasLastRun,
  onRunCase,
  onEdit,
  onDuplicate,
  onStartMoveToSuite,
  onArchive,
}: {
  testCase: TestCase;
  canManage: boolean;
  period: Period;
  hasLastRun: boolean;
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onStartMoveToSuite: (scenarioId: string) => void;
  onArchive: (testCase: TestCase) => void;
}) {
  return (
    <ListTable.ActionCell>
      <HStack gap={1} justify="flex-end">
        {canManage && <RunCaseButton caseName={testCase.name} onOpen={() => onRunCase(testCase)} />}
        <CaseRowActionsMenu
          testCase={testCase}
          canManage={canManage}
          period={period}
          hasLastRun={hasLastRun}
          onEdit={onEdit}
          onDuplicate={onDuplicate}
          onStartMoveToSuite={onStartMoveToSuite}
          onArchive={onArchive}
        />
      </HStack>
    </ListTable.ActionCell>
  );
}

function CaseRowActionsMenu({
  testCase,
  canManage,
  period,
  hasLastRun,
  onEdit,
  onDuplicate,
  onStartMoveToSuite,
  onArchive,
}: {
  testCase: TestCase;
  canManage: boolean;
  period: Period;
  hasLastRun: boolean;
  onEdit: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onStartMoveToSuite: (scenarioId: string) => void;
  onArchive: (testCase: TestCase) => void;
}) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          minWidth="24px"
          height="24px"
          paddingX={0}
          aria-label={`Actions for ${testCase.name}`}
          onClick={stop}
        >
          <MoreVerticalIcon size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {canManage && (
          <Menu.Item
            value="edit"
            onClick={(event) => {
              stop(event);
              onEdit(testCase);
            }}
          >
            <MenuActionLabel action="edit">Edit</MenuActionLabel>
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="duplicate"
            onClick={(event) => {
              stop(event);
              onDuplicate(testCase);
            }}
          >
            <MenuActionLabel action="duplicate">Duplicate</MenuActionLabel>
          </Menu.Item>
        )}
        {hasLastRun && <RecentRunsSubmenu period={period} scenarioIds={[testCase.id]} />}
        {canManage && (
          <Menu.Item
            value="move-to-suite"
            onClick={(event) => {
              stop(event);
              onStartMoveToSuite(testCase.id);
            }}
          >
            <MenuActionLabel action="moveToSuite">Move to suite...</MenuActionLabel>
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="archive"
            color="red.fg"
            onClick={(event) => {
              stop(event);
              onArchive(testCase);
            }}
          >
            <MenuActionLabel action="archive">Archive</MenuActionLabel>
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

/** The rows of a set that runs from code: names and last run times, nothing to change. */
export function ExternalCasesTable({
  cases,
  onRowClick,
}: {
  cases: { scenarioId: string; name: string; lastRunAt: number }[];
  onRowClick: (scenarioId: string) => void;
}) {
  return (
    <CasesListTable
      columns={[{ key: "scenario" }, { key: "last-run", width: EXTERNAL_LAST_RUN_WIDTH }]}
      testId="agent-testing-external-cases-table"
    >
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Scenario</ListTable.ColumnHeader>
          <ListTable.ColumnHeader align="end">Last run</ListTable.ColumnHeader>
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {cases.map((externalCase) => (
          <ListTable.Row
            key={externalCase.scenarioId}
            onActivate={() => onRowClick(externalCase.scenarioId)}
            data-testid={`external-case-row-${externalCase.name}`}
          >
            <ListTable.Cell>
              <chakra.button
                type="button"
                minWidth={0}
                maxWidth="full"
                textAlign="left"
                cursor="pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  onRowClick(externalCase.scenarioId);
                }}
              >
                <Text textStyle="bodySm" fontWeight="medium" color="fg" truncate>
                  {externalCase.name}
                </Text>
              </chakra.button>
            </ListTable.Cell>
            <ListTable.Cell align="end">
              <Text textStyle="micro" color="fg.muted" whiteSpace="nowrap">
                {format(externalCase.lastRunAt, "MMM d, HH:mm")}
              </Text>
            </ListTable.Cell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </CasesListTable>
  );
}

/** The table the scenario list stands in as while it is read: its header over placeholder rows. */
export function CasesTableSkeleton() {
  return (
    <ListTable data-testid="agent-testing-cases-skeleton">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Scenario</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        <ListTable.LoadingRows rows={3} columns={2} />
      </ListTable.Body>
    </ListTable>
  );
}
