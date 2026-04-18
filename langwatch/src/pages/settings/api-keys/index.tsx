import { Badge, Heading, Tabs, Text, VStack } from "@chakra-ui/react";
import SettingsLayout from "../../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { PersonalAccessTokensSection } from "./PersonalAccessTokensSection";
import { ProjectApiKeySection } from "./ProjectApiKeySection";

/**
 * Thin page composer for Settings → API Keys. Switches between the PAT list
 * (preferred) and the project-scoped legacy API key. The heavy lifting lives
 * in the two section components.
 */
export default function ApiKeysPage() {
  const { organization, project } = useOrganizationTeamProject();

  if (!organization) return <SettingsLayout />;

  return (
    <SettingsLayout>
      <VStack gap={4} width="full" maxWidth="960px" align="stretch">
        <VStack gap={1} align="start">
          <Heading size="lg">API Keys</Heading>
          <Text fontSize="sm" color="fg.muted">
            Manage credentials used to authenticate with the LangWatch API.
          </Text>
        </VStack>
        <Tabs.Root variant="line" defaultValue="pats">
          <Tabs.List>
            <Tabs.Trigger
              value="pats"
              color="fg.muted"
              _selected={{ color: "fg", fontWeight: "semibold" }}
            >
              Personal Access Tokens
            </Tabs.Trigger>
            <Tabs.Trigger
              value="project"
              gap={2}
              color="fg.muted"
              _selected={{ color: "fg", fontWeight: "semibold" }}
            >
              Project API Key
              <Badge size="sm" colorPalette="yellow" variant="outline">
                Legacy
              </Badge>
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="pats" paddingTop={6}>
            <PersonalAccessTokensSection
              organizationId={organization.id}
              projectId={project?.id}
            />
          </Tabs.Content>
          <Tabs.Content value="project" paddingTop={6}>
            <ProjectApiKeySection />
          </Tabs.Content>
        </Tabs.Root>
      </VStack>
    </SettingsLayout>
  );
}
