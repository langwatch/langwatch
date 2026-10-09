/**
 * Profile: who I am here, how I get in, where I am signed in, what keys act
 * as me. Four bands, each a narrower kind of "you" than the one above it.
 * Spec: specs/settings/profile.feature
 */

import { Box, Heading, Text, VStack } from "@langwatch/design-system/primitives";
import { SETTINGS_BAND_PADDING_Y } from "@langwatch/design-system/settings-section";

import { BrowserSessionsSection } from "../browser-sessions-section.tsx";
import { PersonalApiKeysSummary } from "../personal-api-keys-summary.tsx";
import { ProfileDetailsSection } from "../profile-details-section.tsx";
import { SignInMethodsSummary } from "../sign-in-methods-summary.tsx";

export default function ProfileScreen() {
  return (
    <Box paddingX={{ base: 4, md: 6 }} paddingY={4} width="full" maxWidth="820px">
      <VStack align="start" gap={1} paddingBottom={SETTINGS_BAND_PADDING_Y}>
        <Heading size="lg">Profile</Heading>
        <Text color="fg.muted">Who you are here, how you get in, and where you are signed in.</Text>
      </VStack>

      <ProfileDetailsSection />
      <SignInMethodsSummary />
      <BrowserSessionsSection />
      <PersonalApiKeysSummary />
    </Box>
  );
}
