/**
 * The rail on the left of the Test cases tab: All test cases, the test suites
 * of the project, and the sets that run from code.
 *
 * The rail is a view over what it is given. Every action it offers is a
 * callback, so the reading of the address and the writing of the data both
 * stay in the panel that owns them.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/suites/suite-folders.feature
 */

import {
  Box,
  Button,
  HStack,
  IconButton,
  Input,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Folder,
  FolderCode,
  LayoutList,
  MoreVertical,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
} from "lucide-react";
import { useCallback, useState } from "react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "~/components/PeriodSelector";
import { PeriodSelector } from "~/components/PeriodSelector";
import { SuiteArchiveDialog } from "~/components/suites/SuiteArchiveDialog";
import { VoiceAgentsCallout } from "~/components/suites/VoiceAgentsCallout";
import { Dialog } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/menu";
import { useNow } from "~/hooks/useNow";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { AgentTestingSelection } from "../useAgentTestingRouting";
import type { ExternalSetEntry, TestSuiteEntry } from "./test-cases";

/** How wide the rail is when it is open. */
export const SUITE_RAIL_WIDTH = 260;

/** What the archive dialog of a test suite says. */
export const SUITE_ARCHIVE_TITLE = "Archive test suite?";
export const SUITE_ARCHIVE_DESCRIPTION =
  "The test cases in it are archived as well. Test runs are preserved.";

export type SuiteRailProps = {
  selection: AgentTestingSelection;
  suites: TestSuiteEntry[];
  externalSets: ExternalSetEntry[];
  isLoading?: boolean;
  /** False for a person who may read the project but not change it. */
  canManage: boolean;
  /** The suites that have a run to open. */
  suiteIdsWithRuns: ReadonlySet<string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (selection: AgentTestingSelection) => void;
  onCreateSuite: (name: string) => void;
  onNewTestCase: (suiteId: string) => void;
  onRunSuite: (suiteId: string) => void;
  onEditSuite: (suiteId: string) => void;
  onOpenLastRun: (suite: TestSuiteEntry) => void;
  onArchiveSuite: (suiteId: string) => void;
  isArchiving?: boolean;
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
};

export function SuiteRail({
  selection,
  suites,
  externalSets,
  isLoading = false,
  canManage,
  suiteIdsWithRuns,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onCreateSuite,
  onNewTestCase,
  onRunSuite,
  onEditSuite,
  onOpenLastRun,
  onArchiveSuite,
  isArchiving = false,
  period,
  periodMode,
  setPeriod,
  setRelativePeriod,
}: SuiteRailProps) {
  const now = useNow();
  const [newSuiteOpen, setNewSuiteOpen] = useState(false);
  const [suiteToArchive, setSuiteToArchive] = useState<TestSuiteEntry | null>(
    null,
  );

  const handleArchiveConfirm = useCallback(() => {
    if (!suiteToArchive) return;
    onArchiveSuite(suiteToArchive.id);
    setSuiteToArchive(null);
  }, [onArchiveSuite, suiteToArchive]);

  return (
    <VStack
      align="stretch"
      gap={0}
      height="full"
      width={collapsed ? "56px" : `${SUITE_RAIL_WIDTH}px`}
      minWidth={collapsed ? "56px" : `${SUITE_RAIL_WIDTH}px`}
      borderRightWidth="1px"
      borderColor="border"
      data-testid="agent-testing-suite-rail"
    >
      <VStack align="stretch" gap={1} flex={1} overflowY="auto" padding={2}>
        <RailItem
          label="All test cases"
          icon={<LayoutList size={14} color="var(--chakra-colors-fg-muted)" />}
          selected={selection.kind === "all"}
          collapsed={collapsed}
          onClick={() => onSelect({ kind: "all" })}
        />

        <RailSectionHeading
          collapsed={collapsed}
          label="Test Suites"
          action={
            canManage ? (
              <IconButton
                aria-label="New test suite"
                size="xs"
                variant="ghost"
                onClick={() => setNewSuiteOpen(true)}
              >
                <Plus size={14} />
              </IconButton>
            ) : null
          }
        />

        {isLoading ? (
          <VStack align="stretch" gap={1} paddingX={1}>
            <Skeleton height="28px" />
            <Skeleton height="28px" />
          </VStack>
        ) : (
          suites.map((suite) => (
            <RailItem
              key={suite.id}
              label={suite.name}
              icon={<Folder size={14} color="var(--chakra-colors-fg-muted)" />}
              selected={
                selection.kind === "suite" && selection.slug === suite.slug
              }
              collapsed={collapsed}
              onClick={() => onSelect({ kind: "suite", slug: suite.slug })}
              actions={
                collapsed ? null : (
                  <SuiteRailMenu
                    suite={suite}
                    canManage={canManage}
                    hasRun={suiteIdsWithRuns.has(suite.id)}
                    onNewTestCase={onNewTestCase}
                    onRunSuite={onRunSuite}
                    onEditSuite={onEditSuite}
                    onOpenLastRun={onOpenLastRun}
                    onArchiveSuite={() => setSuiteToArchive(suite)}
                  />
                )
              }
            />
          ))
        )}

        {externalSets.length > 0 && (
          <>
            <RailSectionHeading collapsed={collapsed} label="External Sets" />
            {externalSets.map((set) => (
              <RailItem
                key={set.setId}
                label={set.setId}
                icon={
                  <FolderCode
                    size={14}
                    color="var(--chakra-colors-fg-muted)"
                    aria-label="Runs from code"
                  />
                }
                caption={
                  set.lastRunTimestamp
                    ? formatTimeAgoCompact(set.lastRunTimestamp, now)
                    : undefined
                }
                selected={
                  selection.kind === "external" && selection.setId === set.setId
                }
                collapsed={collapsed}
                onClick={() => onSelect({ kind: "external", setId: set.setId })}
              />
            ))}
          </>
        )}
      </VStack>

      {!collapsed && <VoiceAgentsCallout />}

      <HStack
        gap={2}
        paddingX={2}
        paddingY={2}
        borderTopWidth="1px"
        borderColor="border"
      >
        {!collapsed && (
          <PeriodSelector
            period={period}
            mode={periodMode}
            setPeriod={setPeriod}
            setRelativePeriod={setRelativePeriod}
            size="xs"
            triggerVariant="ghost"
            placement="top-start"
          />
        )}
        <Spacer />
        <IconButton
          aria-label={collapsed ? "Expand the rail" : "Collapse the rail"}
          size="xs"
          variant="ghost"
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <PanelLeftOpen size={14} />
          ) : (
            <PanelRightOpen size={14} />
          )}
        </IconButton>
      </HStack>

      <NewSuiteDialog
        open={newSuiteOpen}
        onClose={() => setNewSuiteOpen(false)}
        onCreate={(name) => {
          onCreateSuite(name);
          setNewSuiteOpen(false);
        }}
      />

      <SuiteArchiveDialog
        open={!!suiteToArchive}
        onClose={() => setSuiteToArchive(null)}
        onConfirm={handleArchiveConfirm}
        suiteName={suiteToArchive?.name ?? ""}
        isLoading={isArchiving}
        title={SUITE_ARCHIVE_TITLE}
        description={SUITE_ARCHIVE_DESCRIPTION}
      />
    </VStack>
  );
}

function RailSectionHeading({
  label,
  collapsed,
  action,
}: {
  label: string;
  collapsed: boolean;
  action?: React.ReactNode;
}) {
  if (collapsed) return <Box height="8px" />;

  return (
    <HStack gap={1} paddingX={2} paddingTop={3} paddingBottom={1}>
      <Text
        fontSize="xs"
        fontWeight="bold"
        textTransform="uppercase"
        color="fg.muted"
        letterSpacing="0.04em"
      >
        {label}
      </Text>
      <Spacer />
      {action}
    </HStack>
  );
}

/**
 * One row of the rail. The row itself is not a `button` element: it carries
 * the row menu, and a button inside a button is not valid markup. It answers
 * to a click, to Enter and to Space, the way a button does.
 */
function RailItem({
  label,
  caption,
  icon,
  selected,
  collapsed,
  onClick,
  actions,
}: {
  label: string;
  caption?: string;
  icon: React.ReactNode;
  selected: boolean;
  collapsed: boolean;
  onClick: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <HStack
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // The row is not a button element, so Space would scroll the rail.
        event.preventDefault();
        onClick();
      }}
      gap={2}
      width="full"
      paddingX={2}
      paddingY={1.5}
      borderRadius="md"
      textAlign="left"
      cursor="pointer"
      background={selected ? "bg.muted" : "transparent"}
      _hover={{ background: "bg.muted" }}
      data-testid={`suite-rail-item-${label}`}
    >
      {icon}
      {!collapsed && (
        <>
          <Text fontSize="sm" truncate flex={1} minWidth={0}>
            {label}
          </Text>
          {caption && (
            <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
              {caption}
            </Text>
          )}
          {actions}
        </>
      )}
    </HStack>
  );
}

function SuiteRailMenu({
  suite,
  canManage,
  hasRun,
  onNewTestCase,
  onRunSuite,
  onEditSuite,
  onOpenLastRun,
  onArchiveSuite,
}: {
  suite: TestSuiteEntry;
  canManage: boolean;
  hasRun: boolean;
  onNewTestCase: (suiteId: string) => void;
  onRunSuite: (suiteId: string) => void;
  onEditSuite: (suiteId: string) => void;
  onOpenLastRun: (suite: TestSuiteEntry) => void;
  onArchiveSuite: () => void;
}) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${suite.name}`}
          onClick={stop}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {canManage && (
          <Menu.Item
            value="new-test-case"
            onClick={(event) => {
              stop(event);
              onNewTestCase(suite.id);
            }}
          >
            New test case
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="run-suite"
            onClick={(event) => {
              stop(event);
              onRunSuite(suite.id);
            }}
          >
            Run suite
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="edit-suite"
            onClick={(event) => {
              stop(event);
              onEditSuite(suite.id);
            }}
          >
            Edit suite
          </Menu.Item>
        )}
        {hasRun && (
          <Menu.Item
            value="open-last-run"
            onClick={(event) => {
              stop(event);
              onOpenLastRun(suite);
            }}
          >
            Open last run
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="archive-suite"
            color="orange.500"
            onClick={(event) => {
              stop(event);
              onArchiveSuite();
            }}
          >
            Archive suite
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

/** Asks for the name of a new test suite, and nothing else. */
function NewSuiteDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => !nextOpen && onClose()}
      placement="center"
    >
      <Dialog.Content bg="bg" maxWidth="420px">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            New test suite
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Input
            autoFocus
            size="sm"
            placeholder="e.g. Refunds"
            aria-label="Test suite name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            size="sm"
            disabled={!name.trim()}
            onClick={submit}
          >
            Create
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
