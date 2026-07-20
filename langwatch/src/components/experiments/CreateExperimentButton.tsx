import { Spinner } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useState } from "react";

import { createInitialState } from "~/experiments-v3/types";
import { extractPersistedState } from "~/experiments-v3/types/persistence";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { isHandledByGlobalHandler } from "~/utils/trpcError";

import { PageLayout } from "../ui/layouts/PageLayout";
import { toaster } from "../ui/toaster";

export const CreateExperimentButton = () => {
  const { project, hasPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const utils = api.useContext();
  const { checkAndProceed } = useLicenseEnforcement("experiments");
  const createExperiment = api.experiments.saveEvaluationsV3.useMutation({
    onSuccess: (data) => {
      void utils.experiments.getAllForEvaluationsList.invalidate();
      void router.push(`/${project?.slug}/experiments/workbench/${data.slug}`);
      setIsCreating(false);
    },
    onError: (error) => {
      setIsCreating(false);
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Error creating experiment",
        description:
          error instanceof Error
            ? error.message
            : "Please try again. If the problem persists, contact support.",
        type: "error",
        meta: {
          closable: true,
        },
      });
    },
  });

  if (!project || !hasPermission("workflows:create")) return null;

  const handleCreate = () => {
    checkAndProceed(() => {
      if (isCreating) return;

      setIsCreating(true);
      const name = generateHumanReadableId();
      const initialState = createInitialState();
      initialState.name = name;
      const persistedState = extractPersistedState(initialState);

      createExperiment.mutate({
        projectId: project.id,
        experimentId: undefined,
        state: {
          ...persistedState,
          experimentSlug: name,
        },
      });
    });
  };

  return (
    <PageLayout.HeaderButton
      colorPalette="blue"
      variant="solid"
      onClick={handleCreate}
      disabled={isCreating}
    >
      {isCreating ? <Spinner size="xs" /> : <Plus size={16} />}
      New Experiment
    </PageLayout.HeaderButton>
  );
};
