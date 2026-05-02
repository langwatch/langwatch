import { Heading, Text, VStack } from "@chakra-ui/react";
import SettingsLayout from "../../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { ApiKeysSection } from "./ApiKeysSection";

/**
 * Settings > API Keys page. Single unified table showing all API keys
 * (user-scoped and service/project keys) without tabs.
 */
export default function ApiKeysPage() {
  const { organization, project } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return (
    <SettingsLayout>
      <VStack gap={4} width="full" maxWidth="1200px" align="stretch">
        <VStack gap={1} align="start">
          <Heading size="lg">API Keys</Heading>
          <Text fontSize="sm" color="fg.muted">
            Manage credentials used to authenticate with the LangWatch API.
          </Text>
        </VStack>
        <ApiKeysSection
          organizationId={organization.id}
          projectId={project?.id}
        />
      </VStack>
    </SettingsLayout>
  );
}
