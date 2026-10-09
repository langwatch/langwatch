import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { CheckupSettings } from "../../components/settings/checkup/CheckupSettings";
import { SETTINGS_BAND_PADDING_Y } from "../../components/settings/SettingsSection";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export default function Checkup() {
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
          <Heading size="lg">Checkup</Heading>
          <Text color="fg.muted">
            Whether this install is correctly wired, what is broken and how to
            fix it, and exactly what it sends to LangWatch.
          </Text>
        </VStack>

        {organization?.id ? (
          <CheckupSettings organizationId={organization.id} />
        ) : null}
      </Box>
    </SettingsLayout>
  );
}
