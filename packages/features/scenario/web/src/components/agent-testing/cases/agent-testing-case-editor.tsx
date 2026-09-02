/**
 * The one case editor of the Agent Testing page.
 *
 * It is mounted by the page rather than by a tab, so a case opened from the
 * table, from a run row or from the run drawer all land in the same dialog.
 * Save and Run saves first and then opens the run dialog for what it saved.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useCallback, useMemo, useState } from "react";
import { toaster } from "@langwatch/design-system/toaster";
import type { Scenario } from "../../../model/prisma-types";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { readScenarioTarget } from "../../../hooks/use-scenario-target";
import { api } from "../../../behavior/scenario-api";
import { RunDialog } from "../run/run-dialog";
import type { RunDialogSubject } from "../run/run-dialog-types";
import { useAgentTestingStore } from "../use-agent-testing-store";
import { CaseModal } from "./case-modal";
import type { TestSuiteEntry } from "./test-cases";
import { useCaseEditor } from "./use-case-editor";
import { useRunStartedHandler } from "./use-case-run-actions";

/**
 * The suites the editor can file a case under. The rail reads the same list,
 * so this is the cached copy rather than a second read.
 */
function useEditorSuites(projectId: string): TestSuiteEntry[] {
  const { data: folders } = api.suites.folders.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  return useMemo<TestSuiteEntry[]>(
    () =>
      (folders ?? []).map((folder) => ({
        id: folder.id,
        name: folder.name,
        slug: folder.slug,
        caseCount: 0,
      })),
    [folders],
  );
}

/** What a saved case does: say so, close, and run when Save and Run asked. */
function useOnCaseSaved({
  projectId,
  isEditingStoredCase,
  closeCaseEditor,
  setRunSubject,
}: {
  projectId: string;
  isEditingStoredCase: boolean;
  closeCaseEditor: () => void;
  setRunSubject: (subject: RunDialogSubject) => void;
}) {
  return useCallback(
    (
      saved: Scenario,
      { shouldRunAfterSave }: { shouldRunAfterSave: boolean },
    ) => {
      toaster.create({
        title: isEditingStoredCase ? "Test case updated" : "Test case created",
        type: "success",
      });
      closeCaseEditor();
      if (!shouldRunAfterSave) return;
      setRunSubject({
        kind: "case",
        scenarioId: saved.id,
        name: saved.name,
        initialTarget: readScenarioTarget({ projectId, scenarioId: saved.id }),
      });
    },
    [isEditingStoredCase, closeCaseEditor, projectId, setRunSubject],
  );
}

export function AgentTestingCaseEditor() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const caseEditor = useAgentTestingStore((state) => state.caseEditor);
  const closeCaseEditor = useAgentTestingStore(
    (state) => state.closeCaseEditor,
  );
  const onRunStarted = useRunStartedHandler({ projectId });
  const [runSubject, setRunSubject] = useState<RunDialogSubject | null>(null);
  const suites = useEditorSuites(projectId);

  const onSaved = useOnCaseSaved({
    projectId,
    isEditingStoredCase: !!caseEditor.scenarioId,
    closeCaseEditor,
    setRunSubject,
  });

  const editor = useCaseEditor({
    open: caseEditor.open,
    projectId,
    scenarioId: caseEditor.scenarioId,
    folderId: caseEditor.folderId,
    onSaved,
  });

  return (
    <>
      <CaseModal
        open={caseEditor.open}
        scenarioId={caseEditor.scenarioId}
        suites={suites}
        editor={editor}
        onClose={closeCaseEditor}
        openHistoryOnOpen={caseEditor.showHistory}
      />

      <RunDialog
        subject={runSubject}
        onClose={() => setRunSubject(null)}
        onRunStarted={onRunStarted}
      />
    </>
  );
}
