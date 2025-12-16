/**
 * Autosave Hook for Evaluations V3
 *
 * Manages syncing the client-side state with the database.
 */

import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
import { toaster } from "../../../components/ui/toaster";
import { useEvaluationV3Store } from "../store/useEvaluationV3Store";
import { stateToDSL } from "../utils/dslMapper";
import { useAvailableEvaluators } from "../../../hooks/useAvailableEvaluators";
import { getRandomWorkflowIcon } from "../../../optimization_studio/components/workflow/NewWorkflowForm";

let lastAutosave = 0;

export const useAutosaveV3 = () => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const availableEvaluators = useAvailableEvaluators();

  const {
    experimentSlug,
    name,
    dataset,
    agents,
    evaluators,
    agentMappings,
    evaluatorMappings,
    workflowId,
    hasUnsavedChanges,
    setAutosaving,
    setExperimentInfo,
    markUnsavedChanges,
    setState,
  } = useEvaluationV3Store(
    useShallow((s) => ({
      experimentSlug: s.experimentSlug,
      name: s.name,
      dataset: s.dataset,
      agents: s.agents,
      evaluators: s.evaluators,
      agentMappings: s.agentMappings,
      evaluatorMappings: s.evaluatorMappings,
      workflowId: s.workflowId,
      hasUnsavedChanges: s.hasUnsavedChanges,
      setAutosaving: s.setAutosaving,
      setExperimentInfo: s.setExperimentInfo,
      markUnsavedChanges: s.markUnsavedChanges,
      setState: s.setState,
    }))
  );

  const saveExperiment = api.experiments.saveExperiment.useMutation();

  // Create a stringified state for comparison
  const stateString = JSON.stringify({
    name,
    dataset,
    agents,
    evaluators,
    agentMappings,
    evaluatorMappings,
  });

  const previousStateRef = useRef(stateString);

  useEffect(() => {
    setAutosaving(saveExperiment.isLoading);
  }, [saveExperiment.isLoading, setAutosaving]);

  // Redirect to the new slug if needed
  const routerSlug = router.query.slug as string;
  useEffect(() => {
    if (project && experimentSlug && routerSlug !== experimentSlug) {
      void router.replace(`/${project.slug}/evaluations-v3/${experimentSlug}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentSlug]);

  // Autosave effect
  useEffect(() => {
    if (!project) return;
    if (!hasUnsavedChanges) return;
    if (!availableEvaluators) return;

    // Don't save if nothing changed
    if (stateString === previousStateRef.current) return;
    previousStateRef.current = stateString;

    // Debounce
    const now = Date.now();
    if (now - lastAutosave < 500) return;
    lastAutosave = now;

    const saveTimeout = setTimeout(() => {
      void (async () => {
        try {
          // Get current state
          const state = useEvaluationV3Store.getState().getState();

          // Convert to DSL
          const dsl = stateToDSL(state, availableEvaluators);
          const icon = workflowId ? dsl.icon : getRandomWorkflowIcon();

          // Create wizard state (compatibility with existing system)
          const wizardState = {
            step: "results" as const,
            task: "llm_app" as const,
            dataSource: "manual" as const,
            name: state.name,
            workspaceTab: "dataset" as const,
          };

          const updatedExperiment = await saveExperiment.mutateAsync({
            projectId: project.id,
            experimentId: state.experimentId,
            wizardState,
            dsl: {
              ...dsl,
              icon,
            },
          });

          // Update store with experiment info
          setExperimentInfo({
            experimentId: updatedExperiment.id,
            experimentSlug: updatedExperiment.slug,
            workflowId: updatedExperiment.workflowId ?? undefined,
          });

          setState({ name: updatedExperiment.name ?? state.name });
          markUnsavedChanges(false);
        } catch (error) {
          console.error("Failed to autosave:", error);
          toaster.create({
            title: "Failed to save evaluation",
            type: "error",
            meta: { closable: true },
          });
        }
      })();
    }, 500);

    return () => clearTimeout(saveTimeout);
  }, [
    stateString,
    project,
    hasUnsavedChanges,
    availableEvaluators,
    workflowId,
    saveExperiment,
    setExperimentInfo,
    setState,
    markUnsavedChanges,
  ]);
};

