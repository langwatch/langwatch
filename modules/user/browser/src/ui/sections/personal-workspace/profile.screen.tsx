/**
 * Profile: who I am here, how I get in, where I am signed in, what keys act
 * as me. Four bands, each a narrower kind of "you" than the one above it.
 * Spec: specs/settings/profile.feature
 */

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box, Text } from "@langwatch/design-system/primitives";
import { SETTINGS_BAND_PADDING_Y } from "@langwatch/design-system/settings-section";

import { BrowserSessionsSection } from "../browser-sessions-section.tsx";
import { PersonalApiKeysSummary } from "../personal-api-keys-summary.tsx";
import { ProfileDetailsSection } from "../profile-details-section.tsx";
import { SignInMethodsSummary } from "../sign-in-methods-summary.tsx";

export default function ProfileScreen() {
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Profile</PageLayout.Heading>
      </PageLayout.Header>
      <Box paddingTop={4} width="full" maxWidth="820px">
        <Text color="fg.muted" paddingBottom={SETTINGS_BAND_PADDING_Y}>
          Who you are here, how you get in, and where you are signed in.
        </Text>

        <ProfileDetailsSection />
        <SignInMethodsSummary />
        <BrowserSessionsSection />
        <PersonalApiKeysSummary />
      </Box>
    </>
  );
}
