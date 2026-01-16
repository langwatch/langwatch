import { Alert, Box, useDisclosure } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { CurrentDrawer } from "../../../components/CurrentDrawer";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { EvaluationWizard as EvaluationWizardComponent } from "../../../components/evaluations/wizard/EvaluationWizard";
import { useEvaluationWizardStore } from "../../../components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import useAutosaveWizard from "../../../components/evaluations/wizard/hooks/useAutosaveWizard";
import { useInitialLoadExperiment } from "../../../components/evaluations/wizard/hooks/useInitialLoadExperiment";
import { LoadingScreen } from "../../../components/LoadingScreen";
import { Dialog } from "../../../components/ui/dialog";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { isNotFound } from "../../../utils/trpcError";

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
    }),
  );

  useEffect(() => {
    return () => {
      skipNextAutosave();
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isNotFound(initialLoadExperiment.error)) {
    return (
      <DashboardLayout>
        <Box padding={6}>
          <Alert.Root status="warning">
            <Alert.Indicator />
            <Alert.Title>Evaluation not found</Alert.Title>
            <Alert.Description>
              The evaluation you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
            </Alert.Description>
          </Alert.Root>
        </Box>
      </DashboardLayout>
    );
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
            void router.push(`/${project?.slug}/evaluations`);
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
      <CurrentDrawer />
    </>
  );
}
