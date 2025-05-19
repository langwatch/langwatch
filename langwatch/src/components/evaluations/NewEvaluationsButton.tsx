import { useRouter } from "next/router";
import { useDisclosure, Button } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { TeamRoleGroup } from "~/server/api/permission";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { AskIfUserWantsToContinueDraftDialog } from "./AskIfUserWantsToContinueDraftDialog";

export function NewEvaluationButton() {
  const { project, hasTeamPermission } = useOrganizationTeamProject();
  const enabled =
    !!project && hasTeamPermission(TeamRoleGroup.GUARDRAILS_MANAGE);
  const router = useRouter();
  const projectId = project?.id ?? "";
  const { data: lastExperiment } = api.experiments.getLastExperiment.useQuery(
    { projectId },
    { enabled }
  );
  const {
    open: isDialogOpen,
    onOpen: openDialog,
    setOpen: setIsDialogOpen,
  } = useDisclosure();

  if (!enabled) return null;
  const isLastExperimentADraft = lastExperiment?.name?.startsWith("Draft");

  const openNewEvaluation = () => {
    router.push(`/${project.slug}/evaluations/wizard`);
  };

  const handleContinueDraft = () => {
    router.push(`/${project.slug}/evaluations/wizard/${lastExperiment?.slug}`);
  };

  const handleOnClick = () => {
    // If there's a draft, ask if the user wants to continue with it
    // If there's no slug, we can't continue anyway, so just open the new evaluation
    if (isLastExperimentADraft && !!lastExperiment?.slug) {
      openDialog();
    } else {
      openNewEvaluation();
    }
  };

  return (
    <>
      <Button colorPalette="orange" onClick={handleOnClick}>
        <Plus size={16} /> New Evaluation
      </Button>
      <AskIfUserWantsToContinueDraftDialog
        open={isDialogOpen}
        onOpenChange={({ open }) => setIsDialogOpen(open)}
        onStartNew={openNewEvaluation}
        onContinueDraft={handleContinueDraft}
      />
    </>
  );
}
