/**
 * The table of scenarios of the open suite: the name and the labels, with a
 * Run button and a row menu at the end of every row.
 *
 * The table is a grid inside one card, not a ruled table: the columns line up
 * without a vertical rule between them, so a long list of cases reads as a
 * list of names rather than as a spreadsheet.
 *
 * The table carries no last result: authoring stays here and results live on
 * the Results tab. A person who wants the last run of a row reaches it from
 * the row menu.
 *
 * A row carries no Edit button. Clicking the row opens the editor and Edit
 * stays in the row menu, so the editor is reachable two ways without a third
 * control on every line.
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
import { MoreVertical } from "lucide-react";
import { Menu } from "~/components/ui/menu";
import { TagList } from "~/components/ui/TagList";
import type { ScenarioLastResultSummary } from "~/server/scenarios/scenario-event.types";
import { FG_MUTED, ROW_HOVER_BG, TABLE_HEADER_BG } from "../shared/design";
import { MenuActionLabel } from "./MenuActionLabel";
import { RunCaseButton } from "./RunCaseButton";
import type { TestCase } from "./test-cases";

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
  /** The scenarios of the open suite, in order. */
  cases: TestCase[];
  canManage: boolean;
  /** True when the table shows checkboxes for a bulk move-to-suite. */
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  hasLastRunByCase: (scenarioId: string) => boolean;
  onToggleSelected: (scenarioId: string) => void;
  /** Enters selection mode with this row pre-checked. */
  onStartMoveToSuite: (scenarioId: string) => void;
  onRowClick: (testCase: TestCase) => void;
  /** Opens the run dialog for the case. */
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
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
  cases,
  canManage,
  isSelectionMode,
  selectedIds,
  hasLastRunByCase,
  onToggleSelected,
  onStartMoveToSuite,
  onRowClick,
  onRunCase,
  onEdit,
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
        <Text as="span">Scenario</Text>
        <Text as="span" />
      </TableHeaderRow>

      <Box
        css={{
          "& > * + *": {
            borderTopWidth: "1px",
            borderTopColor: "var(--chakra-colors-border-muted)",
          },
        }}
      >
        {cases.map((testCase) => (
          <CaseRow
            key={testCase.id}
            testCase={testCase}
            templateColumns={templateColumns}
            canManage={canManage}
            hasLastRun={hasLastRunByCase(testCase.id)}
            isSelectionMode={isSelectionMode}
            isSelected={selectedIds.has(testCase.id)}
            onToggleSelected={onToggleSelected}
            onStartMoveToSuite={onStartMoveToSuite}
            onRowClick={onRowClick}
            onRunCase={onRunCase}
            onEdit={onEdit}
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
  hasLastRun,
  isSelectionMode,
  isSelected,
  onToggleSelected,
  onStartMoveToSuite,
  onRowClick,
  onRunCase,
  onEdit,
  onDuplicate,
  onOpenLastRun,
  onArchive,
}: {
  testCase: TestCase;
  templateColumns: string;
  canManage: boolean;
  hasLastRun: boolean;
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggleSelected: (scenarioId: string) => void;
  onStartMoveToSuite: (scenarioId: string) => void;
  onRowClick: (testCase: TestCase) => void;
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
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
        hasLastRun={hasLastRun}
        onRunCase={onRunCase}
        onEdit={onEdit}
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
  hasLastRun,
  onRunCase,
  onEdit,
  onDuplicate,
  onStartMoveToSuite,
  onOpenLastRun,
  onArchive,
}: {
  testCase: TestCase;
  canManage: boolean;
  hasLastRun: boolean;
  onRunCase: (testCase: TestCase) => void;
  onEdit: (testCase: TestCase) => void;
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
          onOpen={() => onRunCase(testCase)}
        />
      )}
      <CaseRowActionsMenu
        testCase={testCase}
        canManage={canManage}
        hasLastRun={hasLastRun}
        onEdit={onEdit}
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
  onDuplicate,
  onStartMoveToSuite,
  onOpenLastRun,
  onArchive,
}: {
  testCase: TestCase;
  canManage: boolean;
  hasLastRun: boolean;
  onEdit: (testCase: TestCase) => void;
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
        {hasLastRun && (
          <Menu.Item
            value="open-last-run"
            onClick={(event) => {
              stop(event);
              onOpenLastRun(testCase);
            }}
          >
            <MenuActionLabel action="openLastRun">
              Open last run
            </MenuActionLabel>
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
            <MenuActionLabel action="moveToSuite">
              Move to suite...
            </MenuActionLabel>
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="archive"
            color="red.600"
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
    <TableCard data-testid="agent-testing-external-cases-table">
      <TableHeaderRow templateColumns={EXTERNAL_COLUMNS}>
        <Text as="span">Scenario</Text>
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
