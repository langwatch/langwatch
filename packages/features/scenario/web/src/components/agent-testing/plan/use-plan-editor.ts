/**
 * What the run plan editor reads: the plan itself, and the test cases, agents,
 * prompts and test suites it can be assembled from.
 *
 * The form state is the shared suite form, so the editor keeps every field a
 * run plan has ever carried. Only the way it is drawn is new.
 *
 * @see specs/features/agent-testing/run-plan-editor.feature
 */

import { useArchivedItemsResolution } from "../../suites/use-archived-items-resolution";
import { useSuiteForm } from "@langwatch/suite-web";
import {
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { api } from "../../../behavior/scenario-api";
import { usePlanEditorWrites } from "./use-plan-editor-writes";

/** The key the run plan editor is opened under. */
export const PLAN_EDITOR_DRAWER = "agentTestingPlanEditor";

export type PlanEditorState = ReturnType<typeof usePlanEditor>;

/** The lists a run plan is assembled from, read only while the dialog is open. */
function usePlanEditorChoices({
  projectId,
  isOpen,
  suiteId,
}: {
  projectId: string;
  isOpen: boolean;
  suiteId: string | undefined;
}) {
  const enabled = !!projectId && isOpen;

  const {
    data: suite,
    isLoading: isSuiteLoading,
    error: suiteError,
  } = api.suites.getById.useQuery(
    { projectId, id: suiteId ?? "" },
    { enabled: enabled && !!suiteId },
  );
  const { data: scenarios } = api.scenarios.getAll.useQuery(
    { projectId },
    { enabled },
  );
  const { data: agents } = api.agents.getAll.useQuery(
    { projectId },
    { enabled },
  );
  const { data: prompts } = api.prompts.getAllPromptsForProject.useQuery(
    { projectId },
    { enabled },
  );
  const { data: folders } = api.suites.folders.getAll.useQuery(
    { projectId },
    { enabled },
  );

  return {
    suite,
    isSuiteLoading,
    suiteError,
    scenarios,
    agents,
    prompts,
    folders,
  };
}

export function usePlanEditor() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { closeDrawer, drawerOpen } = useDrawer();
  const params = useDrawerParams();

  const isOpen = drawerOpen(PLAN_EDITOR_DRAWER);
  const suiteId = params.suiteId;
  const isEditing = !!suiteId;

  const callbacks = getFlowCallbacks(PLAN_EDITOR_DRAWER);
  const choices = usePlanEditorChoices({ projectId, isOpen, suiteId });

  const suiteForm = useSuiteForm({
    suite: choices.suite ?? null,
    isOpen,
    suiteId,
    scenarios: choices.scenarios,
    agents: choices.agents,
    prompts: choices.prompts,
    // The run dialog chooses the agent or prompt, and a new plan covers the
    // whole project until it is narrowed.
    picksTargets: false,
    defaultScope: { mode: "all" },
  });

  const { archivedScenariosWithNames, archivedTargetsWithNames } =
    useArchivedItemsResolution({
      archivedScenarioIds: suiteForm.archivedScenarioIds,
      archivedTargets: suiteForm.archivedTargets,
      projectId: project?.id,
    });

  // A plan that cannot be read must not be saved: without it every save would
  // take the create branch and write a second plan.
  const loadError = isEditing && choices.suiteError ? choices.suiteError : null;

  const writes = usePlanEditorWrites({
    projectId,
    isEditing,
    suite: choices.suite,
    form: suiteForm.form,
    onSaved: callbacks?.onSaved,
    onRunRequested: callbacks?.onRunRequested,
    drawerKey: PLAN_EDITOR_DRAWER,
  });

  return {
    isOpen,
    close: closeDrawer,
    /** True while a stored plan is still being read. */
    isLoading: isEditing && choices.isSuiteLoading,
    /** Set when the plan being edited could not be read. */
    loadError,
    isEditing,
    /**
     * True for a plan whose scope is fixed: a test suite runs the cases filed
     * under it, so its case list is not picked in this dialog.
     */
    isFixedScope: choices.suite?.kind === "folder",
    suiteName: choices.suite?.name ?? "",
    suiteForm,
    folders: choices.folders,
    prompts: choices.prompts,
    archivedScenariosWithNames,
    archivedTargetsWithNames,
    ...writes,
  };
}
