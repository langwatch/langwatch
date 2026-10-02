/**
 * Profile: who I am here, how I get in, where I am signed in, what keys act
 * as me. Four bands, each a narrower kind of "you" than the one above it.
 * Spec: specs/settings/profile.feature
 */

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Text, VStack } from "@langwatch/design-system/primitives";

import { BrowserSessionsSection } from "../browser-sessions-section.tsx";
import { PersonalApiKeysSummary } from "../personal-api-keys-summary.tsx";
import { ProfileDetailsSection } from "../profile-details-section.tsx";
import { SignInMethodsSummary } from "../sign-in-methods-summary.tsx";

export default function ProfileScreen() {
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading size="lg">Profile</PageLayout.Heading>
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        <Text color="fg.muted">Who you are here, how you get in, and where you are signed in.</Text>

        <ProfileDetailsSection />
        <SignInMethodsSummary />
        <BrowserSessionsSection />
        <PersonalApiKeysSummary />
      </VStack>
    </>
  );
}
