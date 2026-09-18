/**
 * Profile: who I am here, how I get in, where I am signed in, what keys act
 * as me. Four bands, each a narrower kind of "you" than the one above it.
 * Spec: specs/settings/profile.feature
 */

import { Heading, Text, VStack } from "@chakra-ui/react";
import { BrowserSessionsSection } from "../browser-sessions-section.tsx";
import { PersonalApiKeysSummary } from "../personal-api-keys-summary.tsx";
import { ProfileDetailsSection } from "../profile-details-section.tsx";
import { SignInMethodsSummary } from "../sign-in-methods-summary.tsx";

export default function ProfileScreen() {
  return (
    <VStack gap={6} width="full" align="start">
      <VStack align="start" gap={1}>
        <Heading as="h2">Profile</Heading>
        <Text color="fg.muted">
          Who you are here, how you get in, and where you are signed in.
        </Text>
      </VStack>

      <ProfileDetailsSection />
      <SignInMethodsSummary />
      <BrowserSessionsSection />
      <PersonalApiKeysSummary />
    </VStack>
  );
}
