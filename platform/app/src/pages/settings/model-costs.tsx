import { VStack } from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { LLMModelCost } from "../../components/settings/LLMModelCost";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export default function ModelsPage() {
  const { project } = useOrganizationTeamProject();

  return (
    <SettingsLayout>
      <LLMModelCost projectId={project?.id} />
    </SettingsLayout>
  );
}
