/**
 * The page-level bridge for the Agent Testing scenario editor drawer.
 *
 * The drawer itself is URL routed and lives in `drawerRegistry`. This shell
 * registers the flow callback the drawer calls on save, and mounts the run
 * dialog that Save & Run opens on the same page. It renders no chrome of its
 * own; the drawer is drawn by `<CurrentDrawer />`.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { useCallback, useState, useEffect } from "react";
import type { Scenario } from "../../../../model/prisma-types";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { readScenarioTarget } from "../../use-scenario-target";
import { RunDialog } from "../run/run-dialog";
import type { RunDialogSubject } from "../run/run-dialog-types";
import { useRunStartedHandler } from "./use-case-run-actions";
import { setFlowCallbacks } from "@langwatch/ui-drawer";
import { CASE_EDITOR_DRAWER } from "./agent-testing-case-editor-drawer";

export function AgentTestingCaseEditor() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const onRunStarted = useRunStartedHandler();
  const [runSubject, setRunSubject] = useState<RunDialogSubject | null>(null);

  const handleSaved = useCallback(
    (saved: Scenario, { shouldRunAfterSave }: { shouldRunAfterSave: boolean }) => {
      if (!shouldRunAfterSave) return;
      setRunSubject({
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
