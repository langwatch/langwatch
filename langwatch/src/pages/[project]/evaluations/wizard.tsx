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
import { useInitialLoadExperiment } from "../../../components/evaluations/wizard/hooks/useInitialLoadExperiment";

export default function EvaluationWizard() {
  const { open, setOpen } = useDisclosure();
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  useEffect(() => {
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useAutosaveWizard();

  const { initialLoadExperiment, initialLoadExperimentSlug } =
    useInitialLoadExperiment();

  const { skipNextAutosave, reset } = useEvaluationWizardStore(
    useShallow((state) => {
      return {
        skipNextAutosave: state.skipNextAutosave,
        reset: state.reset,
      };
    })
  );

  useEffect(() => {
    return () => {
      skipNextAutosave();
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isNotFound(initialLoadExperiment.error)) {
    return <ErrorPage statusCode={404} />;
  }

  if (!project) {
    return <LoadingScreen />;
  }

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={({ open }) => {
          if (!open) {
            void router.push(`/${project?.slug}/evaluations_v2`);
          }
        }}
        size="full"
      >
        <EvaluationWizardComponent
          isLoading={
            !!initialLoadExperimentSlug && initialLoadExperiment.isLoading
          }
        />
      </Dialog.Root>
    </>
  );
}
