/**
 * The table of test cases: the name and the labels, with a Run button, an
 * Edit button and a row menu at the end of every row.
 *
 * The table is a grid inside one card, not a ruled table: the columns line up
 * without a vertical rule between them, so a long list of cases reads as a
 * list of names rather than as a spreadsheet.
 *
 * The table carries no last result: authoring stays here and results live on
 * the Results tab. A person who wants the last run of a row reaches it from
 * the row menu.
 *
 * The All test cases surface reads like a code host root: the test suites sit
 * on top as folder rows, and the cases filed in no test suite sit below as
 * loose rows. A folder row opens its own surface; it does not expand in place.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/scenarios/scenario-folder-assignment.feature
 */

import {
  Box,
  Button,
  Checkbox,
  chakra,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { format } from "date-fns";
import { MoreVertical, Pencil } from "lucide-react";
import { Menu } from "~/components/ui/menu";
import { TagList } from "~/components/ui/TagList";
import type { ScenarioLastResultSummary } from "~/server/scenarios/scenario-event.types";
import { FG_MUTED, ROW_HOVER_BG, TABLE_HEADER_BG } from "../shared/design";
import { FolderHeaderRow } from "../shared/FolderHeaderRow";
import { SmallButton } from "../shared/SmallButton";
import { RunCaseButton } from "./RunCaseButton";
import type { CaseGroup, TestCase, TestSuiteEntry } from "./test-cases";

/** The last result of a case, as the aggregate answers it. */
export type CaseLastResult = ScenarioLastResultSummary;

/**
 * The columns of the table: the case name takes the free space, the row
 * actions take what they need on the right. A checkbox column is added at
 * the start of every row when the table is in selection mode.
 */
const BASE_COLUMNS = "minmax(0,1fr) auto";
const CHECKBOX_COLUMN = "24px";
/** A set that runs from code has no controls, and a last run column instead. */
const EXTERNAL_COLUMNS = "minmax(0,1fr) 110px";

export type CasesTableProps = {
  /** The real test suites, drawn as folder rows on the All test cases surface. */
  folderGroups: CaseGroup[];
  /**
   * The cases that sit at the root of the surface: on All test cases the ones
   * filed in no test suite, on a suite surface every case of that suite.
   */
  looseCases: TestCase[];
  /** True on the All test cases surface, where folder rows are drawn. */
  isAllView: boolean;
  /** The test suites a case can be moved into. */
  suites: TestSuiteEntry[];
  canManage: boolean;
  runningCaseId?: string | null;
  /** True when the table shows checkboxes for a bulk move-to-suite. */
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  hasLastRunByCase: (scenarioId: string) => boolean;
  onToggleSelected: (scenarioId: string) => void;
  /** Enters selection mode with this row pre-checked. */
  onStartMoveToSuite: (scenarioId: string) => void;
  onSelectSuite: (suiteId: string) => void;
  onRowClick: (testCase: TestCase) => void;
  /** Opens the run dialog for the case. */
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
  /** Opens the version history drawer of the case. */
  onHistory: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onOpenLastRun: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
};

function TableCard({ children, ...rest }: React.ComponentProps<typeof Box>) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      background="bg.panel"
      overflow="hidden"
      boxShadow="0 1px 2px rgb(16 16 32 / 0.04)"
      {...rest}
    >
      {children}
    </Box>
  );
}

/** The line of column names above the rows. */
function TableHeaderRow({
  templateColumns,
  children,
}: {
  templateColumns: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns={templateColumns}
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
      {children}
    </Box>
  );
}

export function CasesTable({
  folderGroups,
  looseCases,
  isAllView: _isAllView,
  suites: _suites,
  canManage,
  runningCaseId,
  isSelectionMode,
  selectedIds,
  hasLastRunByCase,
  onToggleSelected,
  onStartMoveToSuite,
  onSelectSuite,
  onRowClick,
  onRunCase,
  onEdit,
  onHistory,
  onDuplicate,
  onOpenLastRun,
  onArchive,
}: CasesTableProps) {
  const templateColumns = isSelectionMode
    ? `${CHECKBOX_COLUMN} ${BASE_COLUMNS}`
    : BASE_COLUMNS;

  return (
    <TableCard data-testid="agent-testing-cases-table">
      <TableHeaderRow templateColumns={templateColumns}>
        {isSelectionMode && <Text as="span" />}
        <Text as="span">Test case</Text>
        <Text as="span" />
      </TableHeaderRow>

      {folderGroups.map((group, index) => (
        <FolderHeaderRow
          key={group.id}
          name={group.name}
          caseCount={group.cases.length}
          templateColumns={templateColumns}
          separated={index > 0}
          onClick={() => onSelectSuite(group.id)}
        />
      ))}
      <Box
        css={{
          "& > * + *": {
            borderTopWidth: "1px",
            borderTopColor: "var(--chakra-colors-border-muted)",
          },
        }}
      >
        {looseCases.map((testCase) => (
          <CaseRow
            key={testCase.id}
            testCase={testCase}
            templateColumns={templateColumns}
            canManage={canManage}
            isRunning={runningCaseId === testCase.id}
            hasLastRun={hasLastRunByCase(testCase.id)}
            isSelectionMode={isSelectionMode}
            isSelected={selectedIds.has(testCase.id)}
            onToggleSelected={onToggleSelected}
            onStartMoveToSuite={onStartMoveToSuite}
            onRowClick={onRowClick}
            onRunCase={onRunCase}
            onEdit={onEdit}
            onHistory={onHistory}
            onDuplicate={onDuplicate}
            onOpenLastRun={onOpenLastRun}
            onArchive={onArchive}
          />
        ))}
      </Box>
    </TableCard>
  );
}

function CaseRow({
  testCase,
  templateColumns,
  canManage,
  isRunning,
  hasLastRun,
  isSelectionMode,
  isSelected,
  onToggleSelected,
  onStartMoveToSuite,
  onRowClick,
  onRunCase,
  onEdit,
  onHistory,
  onDuplicate,
  onOpenLastRun,
  onArchive,
}: {
  testCase: TestCase;
  templateColumns: string;
  canManage: boolean;
  isRunning: boolean;
  hasLastRun: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelected: (scenarioId: string) => void;
  onStartMoveToSuite: (scenarioId: string) => void;
  onRowClick: (testCase: TestCase) => void;
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
  onHistory: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onOpenLastRun: (testCase: TestCase) => void;
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
    <Box
      display="grid"
      gridTemplateColumns={templateColumns}
      columnGap={3}
      alignItems="center"
      paddingX={4}
      paddingY="10px"
      cursor="pointer"
      _hover={{ background: ROW_HOVER_BG }}
      onClick={handleRowClick}
      data-testid={`case-row-${testCase.name}`}
    >
      {isSelectionMode && (
        <Box onClick={(event) => event.stopPropagation()}>
          <Checkbox.Root
            checked={isSelected}
            onCheckedChange={() => onToggleSelected(testCase.id)}
            aria-label={`Select ${testCase.name}`}
            data-testid={`case-row-${testCase.name}-checkbox`}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
          </Checkbox.Root>
        </Box>
      )}
      <HStack gap={1.5} minWidth={0} flexWrap="wrap">
        <chakra.button
          type="button"
          minWidth={0}
          textAlign="left"
          cursor="pointer"
          onClick={(event) => {
            event.stopPropagation();
            onRowClick(testCase);
          }}
        >
          <Text fontSize="12.5px" fontWeight="medium" color="fg" truncate>
            {testCase.name}
          </Text>
        </chakra.button>
        <TagList labels={testCase.labels} tone="pastel" />
      </HStack>

      <CaseRowActions
        testCase={testCase}
        canManage={canManage}
        isRunning={isRunning}
        hasLastRun={hasLastRun}
        onRunCase={onRunCase}
        onEdit={onEdit}
        onHistory={onHistory}
        onDuplicate={onDuplicate}
        onStartMoveToSuite={onStartMoveToSuite}
        onOpenLastRun={onOpenLastRun}
        onArchive={onArchive}
      />
    </Box>
  );
}

function CaseRowActions({
  testCase,
  canManage,
  isRunning,
  hasLastRun,
  onRunCase,
  onEdit,
  onHistory,
  onDuplicate,
  onStartMoveToSuite,
  onOpenLastRun,
  onArchive,
}: {
  testCase: TestCase;
  canManage: boolean;
  isRunning: boolean;
  hasLastRun: boolean;
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
  onHistory: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onStartMoveToSuite: (scenarioId: string) => void;
  onOpenLastRun: (testCase: TestCase) => void;
  onArchive: (testCase: TestCase) => void;
}) {
  return (
    <HStack
      gap={1}
      justify="flex-end"
      onClick={(event) => event.stopPropagation()}
    >
      {canManage && (
        <RunCaseButton
          caseName={testCase.name}
          isRunning={isRunning}
          onOpen={() => onRunCase(testCase)}
        />
      )}
      {canManage && (
        <SmallButton
          aria-label={`Edit ${testCase.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onEdit(testCase);
          }}
        >
          <Pencil size={13} />
          Edit
        </SmallButton>
      )}
      <CaseRowActionsMenu
        testCase={testCase}
        canManage={canManage}
        hasLastRun={hasLastRun}
        onEdit={onEdit}
        onHistory={onHistory}
        onDuplicate={onDuplicate}
        onStartMoveToSuite={onStartMoveToSuite}
        onOpenLastRun={onOpenLastRun}
        onArchive={onArchive}
      />
    </HStack>
  );
}

function CaseRowActionsMenu({
  testCase,
  canManage,
  hasLastRun,
  onEdit,
  onHistory,
  onDuplicate,
  onStartMoveToSuite,
  onOpenLastRun,
  onArchive,
}: {
  testCase: TestCase;
  canManage: boolean;
  hasLastRun: boolean;
  onEdit: (testCase: TestCase) => void;
  onHistory: (testCase: TestCase) => void;
  onDuplicate: (testCase: TestCase) => void;
  onStartMoveToSuite: (scenarioId: string) => void;
  onOpenLastRun: (testCase: TestCase) => void;
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
          <MoreVertical size={14} />
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
            Edit
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
            Duplicate
          </Menu.Item>
        )}
        {hasLastRun && (
          <Menu.Item
            value="open-last-run"
            onClick={(event) => {
              stop(event);
              onOpenLastRun(testCase);
            }}
          >
            Open last run
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="move-to-suite"
            onClick={(event) => {
              stop(event);
              onStartMoveToSuite(testCase.id);
            }}
          >
            Move to suite...
          </Menu.Item>
        )}
        <Menu.Item
          value="history"
          onClick={(event) => {
            stop(event);
            onHistory(testCase);
          }}
        >
          History
        </Menu.Item>
        {canManage && (
          <Menu.Item
            value="archive"
            color="red.600"
            onClick={(event) => {
              stop(event);
              onArchive(testCase);
            }}
          >
            Archive
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
    <TableCard data-testid="agent-testing-external-cases-table">
      <TableHeaderRow templateColumns={EXTERNAL_COLUMNS}>
        <Text as="span">Test case</Text>
        <Text as="span" textAlign="right">
          Last run
        </Text>
      </TableHeaderRow>
      <Box
        css={{
          "& > * + *": {
            borderTopWidth: "1px",
            borderTopColor: "var(--chakra-colors-border-muted)",
          },
        }}
      >
        {cases.map((externalCase) => (
          <chakra.button
            key={externalCase.scenarioId}
            type="button"
            width="full"
            textAlign="left"
            display="grid"
            gridTemplateColumns={EXTERNAL_COLUMNS}
            columnGap={3}
            alignItems="center"
            paddingX={4}
            paddingY="10px"
            cursor="pointer"
            _hover={{ background: ROW_HOVER_BG }}
            onClick={() => onRowClick(externalCase.scenarioId)}
            data-testid={`external-case-row-${externalCase.name}`}
          >
            <Text fontSize="12.5px" fontWeight="medium" color="fg" truncate>
              {externalCase.name}
            </Text>
            <Text
              fontSize="11px"
              color={FG_MUTED}
              whiteSpace="nowrap"
              textAlign="right"
            >
              {format(externalCase.lastRunAt, "MMM d, HH:mm")}
            </Text>
          </chakra.button>
        ))}
      </Box>
    </TableCard>
  );
}

/** The skeleton the table stands in as while the case list is read. */
export function CasesTableSkeleton() {
  return (
    <VStack align="stretch" gap={2} data-testid="agent-testing-cases-skeleton">
      <Skeleton height="44px" />
      <Skeleton height="44px" />
      <Skeleton height="44px" />
    </VStack>
  );
}
