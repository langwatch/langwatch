import { Heading, HStack, Text, VStack } from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { LicenseStatus } from "../../components/LicenseStatus";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export default function License() {
  const { organization } = useOrganizationTeamProject();

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full" marginTop={2}>
        <Heading fontSize="lg" as="h2">License</Heading>
        </HStack>
        <Text color="gray.600">
          Manage your LangWatch license for self-hosted deployments. A valid
          license is required for commercial use and enables specific plan
          limits.
        </Text>
        {organization?.id ? (
          <LicenseStatus organizationId={organization.id} />
        ) : (
          <Text>Loading...</Text>
        )}
      </VStack>
    </SettingsLayout>
  );
}
