import { Heading, Text, VStack } from "@chakra-ui/react";
import { LicenseStatus } from "../../components/LicenseStatus";
import SettingsLayout from "../../components/SettingsLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export default function License() {
  const { organization } = useOrganizationTeamProject();

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <Heading>License</Heading>
        <Text color="fg.muted">
          Manage your LangWatch license. Running LangWatch, commercially
          included, never needs one. A license covers the seats you bought and
          unlocks the enterprise capabilities: single sign-on, SCIM provisioning
          and audit logs.
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
