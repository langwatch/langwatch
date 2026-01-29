import { useState } from "react";
import { Button, Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import SettingsLayout from "../../components/SettingsLayout";
import { LicenseStatus } from "../../components/LicenseStatus";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { PageLayout } from "../../components/ui/layouts/PageLayout";

export default function License() {
  const { organization } = useOrganizationTeamProject();
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full">
          <Heading>License</Heading>
          <Spacer />
          {/* <PageLayout.HeaderButton
            onClick={() => setIsGeneratorOpen(true)}
          >
            <Plus size={20} />
            New License
          </PageLayout.HeaderButton> */}
        </HStack>
        <Text color="fg.muted">
          Manage your LangWatch license for self-hosted deployments. A valid
          license is required for commercial use and enables specific plan
          limits.
        </Text>
        {organization?.id ? (
          <LicenseStatus
            organizationId={organization.id}
            isGeneratorOpen={isGeneratorOpen}
            onGeneratorOpenChange={setIsGeneratorOpen}
          />
        ) : (
          <Text>Loading...</Text>
        )}
      </VStack>
    </SettingsLayout>
  );
}
