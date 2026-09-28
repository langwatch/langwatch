/**
 * The page-level bridge for the Agent Testing scenario editor drawer.
 * @see specs/features/agent-testing/cases-table.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { setFlowCallbacks, useDrawer } from "@langwatch/browser-host/drawer";
import { useCallback, useState, useEffect } from "react";

import type { Scenario } from "../../../../behavior/scenario-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { readScenarioTarget } from "../../use-scenario-target.ts";
import type { RunDialogSubject } from "../run/run-dialog-types.ts";
import { RunDialog } from "../run/run-dialog.tsx";
import { CASE_EDITOR_DRAWER } from "./agent-testing-case-editor-drawer.tsx";
import { useRunStartedHandler } from "./use-case-run-actions.ts";

export function AgentTestingCaseEditor() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const onRunStarted = useRunStartedHandler();
  const [runSubject, setRunSubject] = useState<RunDialogSubject | null>(null);
  const [pendingSubject, setPendingSubject] = useState<RunDialogSubject | null>(null);
  const { drawerOpen } = useDrawer();
  const editorIsOpen = drawerOpen(CASE_EDITOR_DRAWER);

  // Opened only once the editor drawer has closed: a dialog opened over it is its nested
  // layer, and closing the drawer dismisses it with it.
  useEffect(() => {
    if (!pendingSubject || editorIsOpen) return;
    setRunSubject(pendingSubject);
    setPendingSubject(null);
  }, [pendingSubject, editorIsOpen]);

  const handleSaved = useCallback(
    (saved: Scenario, { shouldRunAfterSave }: { shouldRunAfterSave: boolean }) => {
      if (!shouldRunAfterSave) return;
      setPendingSubject({
        kind: "case",
        scenarioId: saved.id,
        name: saved.name,
        initialTarget: readScenarioTarget({ projectId, scenarioId: saved.id }),
      });
    },
    [projectId],
  );

  // The registration belongs to this component, which stands for as long as
  // the page does. Save & Run opens the run drawer, and closing that drawer
  // clears the callbacks of the flows that ran through it; without
  // `keepOnClose` this one would go with them and the next Save & Run would
  // only save.
  useEffect(() => {
    setFlowCallbacks(CASE_EDITOR_DRAWER, { onSaved: handleSaved }, { keepOnClose: true });
    return () => setFlowCallbacks(CASE_EDITOR_DRAWER, {});
  }, [handleSaved]);

  return (
    <RunDialog
      subject={runSubject}
      onClose={() => setRunSubject(null)}
      onRunStarted={onRunStarted}
    />
  );
}
