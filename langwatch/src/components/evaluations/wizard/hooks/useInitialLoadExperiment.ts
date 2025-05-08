import { useEffect, useState } from "react";
import { api } from "../../../../utils/api";
import { useRouter } from "next/router";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "./evaluation-wizard-store/useEvaluationWizardStore";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";

export const useInitialLoadExperiment = () => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const {
    setWizardState,
    setDSL,
    experimentSlug,
    setExperimentId,
    setExperimentSlug,
    skipNextAutosave,
  } = useEvaluationWizardStore(
    useShallow(
      ({
        setWizardState,
        setDSL,
        experimentSlug,
        setExperimentSlug,
        setExperimentId,
        skipNextAutosave,
      }) => ({
        setWizardState,
        setDSL,
        experimentSlug,
        setExperimentSlug,
        setExperimentId,
        skipNextAutosave,
      })
    )
  );

  const [initialLoadExperimentSlug_, setInitialLoadExperimentSlug] = useState<
    string | undefined
  >(router.query.slug as string);
  const initialLoadExperimentSlug = initialLoadExperimentSlug_
    ? initialLoadExperimentSlug_
    : !experimentSlug
    ? (router.query.slug as string)
    : undefined;

  const [randomSeed] = useState<number | undefined>(Math.random());
  const initialLoadExperiment =
    api.experiments.getExperimentWithDSLBySlug.useQuery(
      {
        projectId: project?.id ?? "",
        experimentSlug: initialLoadExperimentSlug ?? "",
        randomSeed,
      },
      {
        enabled: !!project && !!initialLoadExperimentSlug,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        staleTime: Infinity,
      }
    );

  useEffect(() => {
    if (
      // First load with id
      !initialLoadExperimentSlug &&
      !experimentSlug
    ) {
      setInitialLoadExperimentSlug(router.query.slug as string);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experimentSlug, initialLoadExperimentSlug]);

  useEffect(() => {
    if (initialLoadExperiment.data) {
      // Prevent autosave from being called on initial load
      skipNextAutosave();
      setWizardState(initialLoadExperiment.data.wizardState ?? {});
      setDSL(initialLoadExperiment.data.dsl ?? {});
      setExperimentId(initialLoadExperiment.data.id);
      setExperimentSlug(initialLoadExperiment.data.slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoadExperiment.data]);

  return {
    initialLoadExperiment,
    initialLoadExperimentSlug,
  };
};
