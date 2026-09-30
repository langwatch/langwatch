import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { ConnectSettings } from "../../components/settings/ConnectSettings";
import { SETTINGS_BAND_PADDING_Y } from "../../components/settings/SettingsSection";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export default function Connect() {
  const { organization } = useOrganizationTeamProject();

  return (
    <SettingsLayout>
      <Box
        paddingX={{ base: 4, md: 6 }}
        paddingY={4}
        width="full"
        maxWidth="820px"
      >
        <VStack align="start" gap={1} paddingBottom={SETTINGS_BAND_PADDING_Y}>
          <Heading size="lg">Connect</Heading>
          <Text color="fg.muted">
            The LangWatch-hosted services this install may call, what each one
            sends, and what they cost.
          </Text>
        </VStack>

        {organization?.id ? (
          <ConnectSettings organizationId={organization.id} />
        ) : null}
      </Box>
    </SettingsLayout>
  );
}
