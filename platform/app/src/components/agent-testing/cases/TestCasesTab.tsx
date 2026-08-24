/**
 * The Test cases tab: the suites rail beside the table of cases.
 *
 * This is where the reads and the writes of the tab live. The rail and the
 * panel below it are views over what they are given.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/features/agent-testing/cases-table.feature
 */

import { Button, HStack, Input, VStack } from "@chakra-ui/react";
import { useCallback, useMemo, useState } from "react";
import { usePeriodSelector } from "~/components/PeriodSelector";
import { ScenarioArchiveDialog } from "~/components/scenarios/ScenarioArchiveDialog";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useCan } from "~/hooks/useCan";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { readScenarioTarget } from "~/hooks/useScenarioTarget";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { api } from "~/utils/api";
import { toExternalPlanSlug } from "../results/run-plans";
import {
  RunDialog,
  type RunDialogSubject,
  type RunStartedInfo,
} from "../run/RunDialog";
import { useAgentTestingRouting } from "../useAgentTestingRouting";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { CasesPanel } from "./CasesPanel";
import { SuiteRail } from "./SuiteRail";
import {
  collectLabels,
  filterCasesByLabels,
  groupCasesByFolder,
  type TestCase,
  type TestSuiteEntry,
} from "./test-cases";
import { useOpenLiveRun } from "./useOpenLiveRun";
import { useExternalSetCases, useTestCasesData } from "./useTestCasesData";

export type TestCasesTabProps = {
  /** Opens the create-a-case flow, filed in the suite it is given. */
  onNewTestCase: (folderId: string | null) => void;
};

export function TestCasesTab({ onNewTestCase }: TestCasesTabProps) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const utils = api.useUtils();
  const { can } = useCan();
  const canManage = can("scenarios:manage");
  const { openDrawer } = useDrawer();
  const { openLiveRun } = useOpenLiveRun();

  const { selection, selectSuite, selectPlan } = useAgentTestingRouting();
  const { period, mode, setPeriod, setRelativePeriod } = usePeriodSelector(30);
  const railCollapsed = useAgentTestingStore((state) => state.railCollapsed);
  const toggleRailCollapsed = useAgentTestingStore(
    (state) => state.toggleRailCollapsed,
  );
  const setPendingBatchRunId = useAgentTestingStore(
    (state) => state.setPendingBatchRunId,
  );

  const {
    suites,
    cases,
    externalSets,
    lastResults,
    isLastResultsLoading,
    suiteIdsWithRuns,
    authorNameById,
    isLoading,
  } = useTestCasesData({ period });

  const externalSetId = selection.kind === "external" ? selection.setId : "";
  const { cases: externalCases, isLoading: isExternalLoading } =
    useExternalSetCases({
      setId: externalSetId,
      period,
      enabled: selection.kind === "external",
    });

  const selectedSuite = useMemo<TestSuiteEntry | null>(() => {
    if (selection.kind !== "suite") return null;
    return suites.find((suite) => suite.slug === selection.slug) ?? null;
  }, [selection, suites]);

  const [activeLabels, setActiveLabels] = useState<string[]>([]);
  const [caseToArchive, setCaseToArchive] = useState<TestCase | null>(null);
  const [suiteToRename, setSuiteToRename] = useState<TestSuiteEntry | null>(
    null,
  );
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);

  const visibleCases = useMemo(() => {
    const scoped =
      selection.kind === "suite"
        ? cases.filter((testCase) => testCase.folderId === selectedSuite?.id)
        : cases;
    return filterCasesByLabels(scoped, activeLabels);
  }, [cases, selection, selectedSuite, activeLabels]);

  const groups = useMemo(
    () =>
      selection.kind === "suite"
        ? [
            {
              id: selectedSuite?.id ?? "",
              name: selectedSuite?.name ?? "",
              cases: visibleCases,
            },
          ]
        : groupCasesByFolder({ cases: visibleCases, suites }),
    [selection, selectedSuite, visibleCases, suites],
  );

  const invalidate = useCallback(() => {
    void utils.scenarios.getAll.invalidate({ projectId });
    void utils.suites.folders.getAll.invalidate({ projectId });
  }, [utils, projectId]);

  // --- Test suites -------------------------------------------------------

  const createFolder = api.suites.folders.create.useMutation({
    onSuccess: (folder) => {
      invalidate();
      selectSuite({ kind: "suite", slug: folder.slug });
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't create the test suite",
      }),
  });

  const renameFolder = api.suites.folders.rename.useMutation({
    onSuccess: () => {
      invalidate();
      setSuiteToRename(null);
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't rename the test suite",
      }),
  });

  const archiveFolder = api.suites.folders.archive.useMutation({
    onSuccess: () => {
      invalidate();
      selectSuite({ kind: "all" });
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't archive the test suite",
      }),
  });

  // --- Test cases --------------------------------------------------------

  const archiveScenario = api.scenarios.archive.useMutation({
    onSuccess: () => {
      invalidate();
      setCaseToArchive(null);
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't archive the test case",
      }),
  });

  const duplicateScenario = api.scenarios.duplicate.useMutation({
    onSuccess: () => {
      invalidate();
      toaster.create({ title: "Test case duplicated", type: "success" });
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't duplicate the test case",
      }),
  });

  const moveToFolder = api.scenarios.moveToFolder.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't move the test case" }),
  });

  // --- Runs --------------------------------------------------------------
  //
  // Every run entry opens the run dialog; the dialog owns the target choice,
  // the note, the overrides, and the run itself.

  const [runSubject, setRunSubject] = useState<RunDialogSubject | null>(null);
  const lastRunTarget = useAgentTestingStore((state) => state.lastRunTarget);

  const subjectForSuite = useCallback(
    (suite: TestSuiteEntry): RunDialogSubject => {
      const persisted = suite.targets?.[0];
      return {
        kind: "suite",
        suiteId: suite.id,
        name: suite.name,
        scenarioIds: cases
          .filter((testCase) => testCase.folderId === suite.id)
          .map((testCase) => testCase.id),
        initialTarget: persisted
          ? { type: persisted.type, id: persisted.referenceId }
          : null,
      };
    },
    [cases],
  );

  const handleRunCase = useCallback(
    (testCase: TestCase) => {
      setRunSubject({
        kind: "case",
        scenarioId: testCase.id,
        name: testCase.name,
        initialTarget: readScenarioTarget({
          projectId,
          scenarioId: testCase.id,
        }),
      });
    },
    [projectId],
  );

  const handleRunSet = useCallback(() => {
    if (selection.kind === "suite" && selectedSuite) {
      setRunSubject(subjectForSuite(selectedSuite));
      return;
    }
    setRunSubject({ kind: "all", initialTarget: lastRunTarget });
  }, [selection, selectedSuite, subjectForSuite, lastRunTarget]);

  const handleRunSuiteById = useCallback(
    (suiteId: string) => {
      const suite = suites.find((entry) => entry.id === suiteId);
      if (suite) setRunSubject(subjectForSuite(suite));
    },
    [suites, subjectForSuite],
  );

  const handleRunStarted = useCallback(
    (info: RunStartedInfo) => {
      setPendingBatchRunId(info.batchRunId);
      if (!info.scenarioId) {
        toaster.create({ title: "Run scheduled", type: "success" });
        return;
      }
      // A one-off run opens in the drawer right away and streams into it.
      setRunningCaseId(info.scenarioId);
      openLiveRun({
        batchRunId: info.batchRunId,
        scenarioSetId: info.scenarioSetId ?? getOnPlatformSetId(projectId),
        scenarioId: info.scenarioId,
        targetId: info.targetId,
      });
    },
    [setPendingBatchRunId, openLiveRun, projectId],
  );

  // --- Opening things ----------------------------------------------------

  const openEditor = useCallback(
    (testCase: TestCase) => {
      openDrawer("scenarioEditor", {
        variant: "agent-testing",
        urlParams: { scenarioId: testCase.id },
      });
    },
    [openDrawer],
  );

  const handleOpenHistory = useCallback(
    (testCase: TestCase) => {
      openDrawer("scenarioVersionHistory", {
        urlParams: { scenarioId: testCase.id },
      });
    },
    [openDrawer],
  );

  const handleOpenLastRun = useCallback(
    (testCase: TestCase) => {
      const lastResult = lastResults.get(testCase.id);
      if (!lastResult) return;
      openLiveRun({
        batchRunId: lastResult.batchRunId,
        scenarioSetId: lastResult.scenarioSetId,
        scenarioId: testCase.id,
      });
    },
    [lastResults, openLiveRun],
  );

  const handleRowClick = useCallback(
    (testCase: TestCase) => {
      if (lastResults.has(testCase.id)) {
        handleOpenLastRun(testCase);
        return;
      }
      openEditor(testCase);
    },
    [lastResults, handleOpenLastRun, openEditor],
  );

  const handleToggleLabel = useCallback((label: string) => {
    setActiveLabels((current) =>
      current.includes(label)
        ? current.filter((entry) => entry !== label)
        : [...current, label],
    );
  }, []);

  const title =
    selection.kind === "all"
      ? "All test cases"
      : selection.kind === "suite"
        ? (selectedSuite?.name ?? "Test suite")
        : externalSetId;

  return (
    <HStack
      width="full"
      height="full"
      gap={0}
      alignItems="stretch"
      data-testid="agent-testing-cases-tab"
    >
      <SuiteRail
        selection={selection}
        suites={suites}
        externalSets={externalSets}
        allCasesCount={cases.length}
        isLoading={isLoading}
        canManage={canManage}
        suiteIdsWithRuns={suiteIdsWithRuns}
        collapsed={railCollapsed}
        onToggleCollapsed={toggleRailCollapsed}
        onSelect={selectSuite}
        onCreateSuite={(name) => createFolder.mutate({ projectId, name })}
        onNewTestCase={(suiteId) => onNewTestCase(suiteId)}
        onRunSuite={handleRunSuiteById}
        onEditSuite={(suiteId) =>
          setSuiteToRename(suites.find((suite) => suite.id === suiteId) ?? null)
        }
        onOpenLastRun={(suite) => selectPlan(suite.slug)}
        onArchiveSuite={(suiteId) =>
          archiveFolder.mutate({ projectId, folderId: suiteId })
        }
        isArchiving={archiveFolder.isPending}
        period={period}
        periodMode={mode}
        setPeriod={setPeriod}
        setRelativePeriod={setRelativePeriod}
      />

      <VStack align="stretch" flex={1} minWidth={0} gap={0}>
        <CasesPanel
          selection={selection}
          title={title}
          groups={groups}
          externalCases={externalCases}
          isLoading={
            selection.kind === "external" ? isExternalLoading : isLoading
          }
          lastResults={lastResults}
          isLastResultsLoading={isLastResultsLoading}
          authorNameById={authorNameById}
          suites={suites}
          canManage={canManage}
          projectHasNoCases={cases.length === 0}
          allLabels={collectLabels(cases)}
          activeLabels={activeLabels}
          onToggleLabel={handleToggleLabel}
          runningCaseId={runningCaseId}
          onRunSet={handleRunSet}
          onNewTestCase={() => onNewTestCase(selectedSuite?.id ?? null)}
          onSelectSuite={(suiteId) => {
            const suite = suites.find((entry) => entry.id === suiteId);
            if (suite) selectSuite({ kind: "suite", slug: suite.slug });
          }}
          onRowClick={handleRowClick}
          onRunCase={handleRunCase}
          onEdit={openEditor}
          onHistory={handleOpenHistory}
          onDuplicate={(testCase) =>
            duplicateScenario.mutate({ projectId, scenarioId: testCase.id })
          }
          onMoveToSuite={(testCase, suiteId) =>
            moveToFolder.mutate({
              projectId,
              scenarioId: testCase.id,
              folderId: suiteId,
            })
          }
          onOpenLastRun={handleOpenLastRun}
          onArchive={setCaseToArchive}
          onOpenExternalCase={() =>
            selectPlan(toExternalPlanSlug(externalSetId))
          }
        />
      </VStack>

      <RunDialog
        subject={runSubject}
        onClose={() => setRunSubject(null)}
        onRunStarted={handleRunStarted}
        onCaseRunSettled={() => setRunningCaseId(null)}
      />

      <ScenarioArchiveDialog
        open={!!caseToArchive}
        onClose={() => setCaseToArchive(null)}
        onConfirm={() => {
          if (!caseToArchive) return;
          archiveScenario.mutate({ projectId, id: caseToArchive.id });
        }}
        scenarios={caseToArchive ? [caseToArchive] : []}
        isLoading={archiveScenario.isPending}
      />

      <RenameSuiteDialog
        suite={suiteToRename}
        isLoading={renameFolder.isPending}
        onClose={() => setSuiteToRename(null)}
        onRename={(name) => {
          if (!suiteToRename) return;
          renameFolder.mutate({ projectId, folderId: suiteToRename.id, name });
        }}
      />
    </HStack>
  );
}

/**
 * The editor of a test suite. A suite holds a name and its cases; the agents
 * it runs against are chosen in the run dialog each run, so the name is what
 * there is to edit here.
 */
function RenameSuiteDialog({
  suite,
  isLoading,
  onClose,
  onRename,
}: {
  suite: TestSuiteEntry | null;
  isLoading: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState("");

  return (
    <Dialog.Root
      open={!!suite}
      onOpenChange={({ open }) => !open && onClose()}
      placement="center"
    >
      <Dialog.Content bg="bg" maxWidth="420px">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Edit test suite
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Input
            autoFocus
            size="sm"
            aria-label="Test suite name"
            defaultValue={suite?.name ?? ""}
            onChange={(event) => setName(event.target.value)}
          />
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            size="sm"
            loading={isLoading}
            onClick={() => onRename((name || suite?.name) ?? "")}
          >
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
