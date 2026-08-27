/**
 * The page-level bridge for the Agent Testing case editor drawer.
 *
 * The drawer itself is URL routed and lives in `drawerRegistry`. This shell
 * registers the flow callback the drawer calls on save, and mounts the run
 * dialog that Save & Run opens on the same page. It renders no chrome of its
 * own; the drawer is drawn by `<CurrentDrawer />`.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { useCallback, useEffect, useState } from "react";
import type { Scenario } from "~/generated/prisma/client";
import { setFlowCallbacks } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { readScenarioTarget } from "~/hooks/useScenarioTarget";
import { RunDialog } from "../run/RunDialog";
import type { RunDialogSubject } from "../run/run-dialog-types";
import { CASE_EDITOR_DRAWER } from "./AgentTestingCaseEditorDrawer";
import { useRunStartedHandler } from "./useCaseRunActions";

export function AgentTestingCaseEditor() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const onRunStarted = useRunStartedHandler();
  const [runSubject, setRunSubject] = useState<RunDialogSubject | null>(null);

  const handleSaved = useCallback(
    (
      saved: Scenario,
      { shouldRunAfterSave }: { shouldRunAfterSave: boolean },
    ) => {
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

  useEffect(() => {
    setFlowCallbacks(CASE_EDITOR_DRAWER, { onSaved: handleSaved });
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
