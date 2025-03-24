import { useEffect } from "react";
import {
  initialState,
  useEvaluationWizardStore,
} from "../../hooks/useEvaluationWizardStore";
import { api } from "../../utils/api";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRouter } from "next/router";
import { useShallow } from "zustand/react/shallow";
import { getWorkflow } from "./useWorkflowStore";

const stringifiedInitialState = JSON.stringify({
  wizardState: initialState.wizardState,
  dsl: getWorkflow(initialState.workflowStore),
});

const useAutosaveWizard = () => {
  const { project } = useOrganizationTeamProject();
  const {
    experimentSlug,
    wizardState,
    dsl,
    autosaveDisabled,
    setExperimentSlug,
    setIsAutosaving,
    setWizardState,
    skipNextAutosave,
  } = useEvaluationWizardStore(
    useShallow(
      ({
        experimentSlug,
        wizardState,
        getDSL,
        autosaveDisabled,
        setExperimentSlug,
        setIsAutosaving,
        setWizardState,
        skipNextAutosave,
      }) => ({
        experimentSlug,
        wizardState,
        dsl: getDSL(),
        autosaveDisabled,
        setExperimentSlug,
        setIsAutosaving,
        setWizardState,
        skipNextAutosave,
      })
    )
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
    { enabled: !!project && !!experimentSlug }
  );

  useEffect(() => {
    setIsAutosaving(saveExperiment.isLoading);
  }, [saveExperiment.isLoading, setIsAutosaving]);

  const router = useRouter();
  const routerSlug = router.query.slug as string;
  useEffect(() => {
    if (project && experimentSlug && routerSlug !== experimentSlug) {
      void router.replace(
        `/${project.slug}/evaluations/wizard/${experimentSlug}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentSlug]);

  useEffect(() => {
    if (!project) return;
    if ((!!experimentSlug || !!routerSlug) && !experiment.data) return;
    if (autosaveDisabled) return;

    if (!!experiment.data?.id || stringifiedState !== stringifiedInitialState) {
      void (async () => {
        const updatedExperiment = await saveExperiment.mutateAsync({
          projectId: project.id,
          experimentId: experiment.data?.id,
          wizardState,
          dsl,
        });

        // Prevent re-triggering autosave on name change
        skipNextAutosave();
        setExperimentSlug(updatedExperiment.slug);
        setWizardState({ name: updatedExperiment.name ?? undefined });
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stringifiedState]);
};

export default useAutosaveWizard;
