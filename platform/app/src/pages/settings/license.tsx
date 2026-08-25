import { Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { LicenseStatus } from "../../components/LicenseStatus";
import SettingsLayout from "../../components/SettingsLayout";
import { PageLayout } from "../../components/ui/layouts/PageLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export default function License() {
  const { organization } = useOrganizationTeamProject();
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const publicEnv = usePublicEnv();

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full">
          <Heading>License</Heading>
          <Spacer />
          {publicEnv.data?.IS_SAAS && (
            <PageLayout.HeaderButton onClick={() => setIsGeneratorOpen(true)}>
              <Plus size={20} />
              New License
            </PageLayout.HeaderButton>
          )}
        </HStack>
        <Text color="fg.muted">
          Manage your LangWatch license. Running LangWatch, commercially included, never
          needs one. A license covers the seats you bought and unlocks the enterprise
          capabilities: single sign-on, SCIM provisioning and audit logs.
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
