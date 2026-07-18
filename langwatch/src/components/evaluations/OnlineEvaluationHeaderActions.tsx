import { Plus, Shield } from "lucide-react";

import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { PageLayout } from "../ui/layouts/PageLayout";

export const OnlineEvaluationHeaderActions = () => {
  const { project, hasPermission } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  if (!project || !hasPermission("evaluations:manage")) return null;

  return (
    <>
      <PageLayout.HeaderButton onClick={() => openDrawer("guardrails", {})}>
        <Shield size={16} />
        Set up Guardrail
      </PageLayout.HeaderButton>
      <PageLayout.HeaderButton
        colorPalette="blue"
        variant="solid"
        onClick={() => openDrawer("onlineEvaluation", {})}
      >
        <Plus size={16} />
        New Online Evaluation
      </PageLayout.HeaderButton>
    </>
  );
};
