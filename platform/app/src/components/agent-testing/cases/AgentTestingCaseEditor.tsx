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
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { readScenarioTarget } from "~/hooks/useScenarioTarget";
import { toaster } from "~/components/ui/toaster";
import type { Scenario } from "~/generated/prisma/client";
import { api } from "~/utils/api";
import { RunDialog } from "../run/RunDialog";
import type { RunDialogSubject } from "../run/run-dialog-types";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { CaseModal } from "./CaseModal";
import type { TestSuiteEntry } from "./test-cases";
import { useCaseEditor } from "./useCaseEditor";
import { useRunStartedHandler } from "./useCaseRunActions";

export function AgentTestingCaseEditor() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { openDrawer } = useDrawer();
  const caseEditor = useAgentTestingStore((state) => state.caseEditor);
  const closeCaseEditor = useAgentTestingStore(
    (state) => state.closeCaseEditor,
  );
  const onRunStarted = useRunStartedHandler({ projectId });
  const [runSubject, setRunSubject] = useState<RunDialogSubject | null>(null);

  // The rail reads the same list, so this is the cached copy rather than a
  // second read.
  const { data: folders } = api.suites.folders.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const suites = useMemo<TestSuiteEntry[]>(
    () =>
      (folders ?? []).map((folder) => ({
        id: folder.id,
        name: folder.name,
        slug: folder.slug,
        caseCount: 0,
      })),
    [folders],
  );

  const onSaved = useCallback(
    (saved: Scenario, { runAfter }: { runAfter: boolean }) => {
      toaster.create({
        title: caseEditor.scenarioId ? "Test case updated" : "Test case created",
        type: "success",
      });
      closeCaseEditor();
      if (!runAfter) return;
      setRunSubject({
        kind: "case",
        scenarioId: saved.id,
        name: saved.name,
        initialTarget: readScenarioTarget({ projectId, scenarioId: saved.id }),
      });
    },
    [caseEditor.scenarioId, closeCaseEditor, projectId],
  );

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
        onOpenHistory={() => {
          if (!caseEditor.scenarioId) return;
          openDrawer("scenarioVersionHistory", {
            urlParams: { scenarioId: caseEditor.scenarioId },
          });
        }}
      />

      <RunDialog
        subject={runSubject}
        onClose={() => setRunSubject(null)}
        onRunStarted={onRunStarted}
      />
    </>
  );
}
