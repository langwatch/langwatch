import { useEffect, useState } from "react";
import { api } from "../../../../utils/api";
import { useRouter } from "next/router";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../hooks/useEvaluationWizardStore";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { TRPCClientErrorLike } from "@trpc/react-query";
import type { AppRouter } from "../../../../server/api/root";
import type { inferRouterOutputs } from "@trpc/server";

export const useInitialLoadExperiment = () => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const {
    setWizardState,
    setDSL,
    experimentSlug,
    setExperimentSlug,
    skipNextAutosave,
  } = useEvaluationWizardStore(
    useShallow(
      ({
        setWizardState,
        setDSL,
        experimentSlug,
        setExperimentSlug,
        skipNextAutosave,
      }) => ({
        setWizardState,
        setDSL,
        experimentSlug,
        setExperimentSlug,
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

  useEffect(() => {
    // For some reason it starts as undefined, so we need to set it here
    if (!initialLoadExperimentSlug && !experimentSlug) {
      setInitialLoadExperimentSlug(router.query.slug as string);
    }
  }, [experimentSlug, initialLoadExperimentSlug, router.query.slug]);

  const experiment = api.experiments.getExperimentWithDSLBySlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: initialLoadExperimentSlug ?? "",
    },
    {
      enabled: !!project && !!initialLoadExperimentSlug,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    }
  );

  const [initialLoadExperiment, setInitialLoadExperiment] =
    useState<
      UseTRPCQueryResult<
        inferRouterOutputs<AppRouter>["experiments"]["getExperimentWithDSLBySlug"],
        TRPCClientErrorLike<AppRouter>
      >
    >(experiment);

  useEffect(() => {
    if (experiment.data && !initialLoadExperiment.data) {
      console.log("effect?");
      setInitialLoadExperiment(experiment);
      // Prevent autosave from being called on initial load
      skipNextAutosave();
      setWizardState(experiment.data.wizardState ?? {});
      setDSL(experiment.data.dsl ?? {});
      setExperimentSlug(experiment.data.slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [experiment.data]);

  return {
    initialLoadExperiment,
    initialLoadExperimentSlug,
  };
};
