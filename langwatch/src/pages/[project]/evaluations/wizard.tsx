import { useDisclosure } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { EvaluationWizard as EvaluationWizardComponent } from "../../../components/evaluations/wizard/EvaluationWizard";
import { Dialog } from "../../../components/ui/dialog";
import EvaluationsV2 from "../evaluations_v2";
import { useRouter } from "next/router";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
import { isNotFound } from "../../../utils/trpcError";
import ErrorPage from "next/error";
import { useEvaluationWizardStore } from "../../../components/evaluations/wizard/hooks/useEvaluationWizardStore";
import { useShallow } from "zustand/react/shallow";
import { LoadingScreen } from "../../../components/LoadingScreen";
import useAutosaveWizard from "../../../optimization_studio/hooks/useAutosaveWizard";

export default function EvaluationWizard() {
  const { open, setOpen } = useDisclosure();
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  useEffect(() => {
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const initialLoadExperiment =
    api.experiments.getExperimentWithDSLBySlug.useQuery(
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

  useAutosaveWizard();

  useEffect(() => {
    if (initialLoadExperiment.data) {
      // Prevent autosave from being called on initial load
      skipNextAutosave();
      setWizardState(initialLoadExperiment.data.wizardState ?? {});
      setDSL(initialLoadExperiment.data.dsl ?? {});
      setExperimentSlug(initialLoadExperiment.data.slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoadExperiment.data]);

  if (isNotFound(initialLoadExperiment.error)) {
    return <ErrorPage statusCode={404} />;
  }

  if (
    !project ||
    (initialLoadExperimentSlug && initialLoadExperiment.isLoading)
  ) {
    return <LoadingScreen />;
  }

  return (
    <>
      <EvaluationsV2 />
      <Dialog.Root
        open={open}
        onOpenChange={({ open }) => {
          if (!open) {
            void router.push(`/${project?.slug}/evaluations_v2`);
          }
        }}
        size="full"
      >
        <EvaluationWizardComponent />
      </Dialog.Root>
    </>
  );
}
