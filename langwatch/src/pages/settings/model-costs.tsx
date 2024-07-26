import { VStack } from "@chakra-ui/react";
import { LLMModelCost } from "../../components/settings/LLMModelCost";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export default function ModelsPage() {
  const { project } = useOrganizationTeamProject();

  return (
    <SettingsLayout>
      <VStack
        spacing={6}
        width="full"
        align="start"
        paddingY={6}
        paddingX={4}
        paddingBottom={12}
      >
        <LLMModelCost projectId={project?.id} />
      </VStack>
    </SettingsLayout>
  );
}
