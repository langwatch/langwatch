import { useRouter } from "next/router";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { captureException } from "~/utils/posthogErrorCapture";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { getRandomWorkflowIcon } from "../../../../optimization_studio/components/workflow/NewWorkflowForm";
import { getWorkflow } from "../../../../optimization_studio/hooks/useWorkflowStore";
import { api } from "../../../../utils/api";
import { toaster } from "../../../ui/toaster";
import {
  initialState,
  useEvaluationWizardStore,
} from "./evaluation-wizard-store/useEvaluationWizardStore";

const stringifiedInitialState = JSON.stringify({
  wizardState: initialState.wizardState,
  dsl: getWorkflow(initialState.workflowStore),
});

let lastAutosave = 0;

/**
 * Manages syncing the client-side wizard state with the database
 */
const useAutosaveWizard = () => {
  const { project } = useOrganizationTeamProject();
  const {
    experimentSlug,
    wizardState,
    dsl,
    autosaveDisabled,
    setExperimentId,
    setExperimentSlug,
    setIsAutosaving,
    setWizardState,
    skipNextAutosave,
    setWorkflow,
  } = useEvaluationWizardStore(
    useShallow(
      ({
        experimentSlug,
        wizardState,
        getDSL,
        autosaveDisabled,
        setExperimentId,
        setExperimentSlug,
        setIsAutosaving,
        setWizardState,
        skipNextAutosave,
        workflowStore,
      }) => ({
        experimentSlug,
        wizardState,
        dsl: getDSL(),
        autosaveDisabled,
        setExperimentId,
        setExperimentSlug,
        setIsAutosaving,
        setWizardState,
        skipNextAutosave,
        setWorkflow: workflowStore.setWorkflow,
      }),
    ),
  );

  const stringifiedState = JSON.stringify({
    wizardState,
    dsl,
  });

  const saveExperiment = api.experiments.saveExperiment.useMutation();

  const experiment = api.experiments.getExperimentWithDSLBySlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: experimentSlug ?? "",
    },
    { enabled: !!project && !!experimentSlug },
  );

  useEffect(() => {
    setIsAutosaving(saveExperiment.isLoading);
  }, [saveExperiment.isLoading, setIsAutosaving]);

  const router = useRouter();
  const routerSlug = router.query.slug as string;
  useEffect(() => {
    if (project && experimentSlug && routerSlug !== experimentSlug) {
      void router.replace(
        `/${project.slug}/evaluations/wizard/${experimentSlug}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentSlug]);

  useEffect(() => {
    if (!project) return;
    if ((!!experimentSlug || !!routerSlug) && !experiment.data) return;
    if (autosaveDisabled) return;
    if (experimentSlug && !wizardState.name) return;

    const now = Date.now();
    if (now - lastAutosave < 100) return;
    lastAutosave = now;

    if (!!experiment.data?.id || stringifiedState !== stringifiedInitialState) {
      void (async () => {
        try {
          const icon = dsl.workflow_id ? dsl.icon : getRandomWorkflowIcon();
          const updatedExperiment = await saveExperiment.mutateAsync({
            projectId: project.id,
            experimentId: experiment.data?.id,
            wizardState,
            dsl: {
              ...dsl,
              icon,
            },
          });

          // Sometimes autosave would keep true even after the mutation is done, this ensures it's set to false
          setIsAutosaving(false);

          // Prevent re-triggering autosave on name changes
          skipNextAutosave();

          setExperimentId(updatedExperiment.id);
          setExperimentSlug(updatedExperiment.slug);
          setWizardState({ name: updatedExperiment.name ?? undefined });
          setWorkflow({
            workflow_id: updatedExperiment.workflowId ?? undefined,
            icon,
            experiment_id: updatedExperiment.id,
          });
        } catch (error) {
          console.log("Failed to autosave evaluation:", error);
          toaster.create({
            title: "Failed to autosave evaluation",
            type: "error",
            meta: {
              closable: true,
            },
          });
          captureException(error, {
            extra: {
              context: "Failed to autosave evaluation",
              projectId: project.id,
              wizardState,
              dsl,
            },
          });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stringifiedState]);
};

export default useAutosaveWizard;
