/**
 * Security settings page (/settings/security), renamed from Authentication
 * (now a redirect). Four bands: what "sam" is known by, the two proofs, the
 * password.
 */

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Text, VStack } from "@langwatch/design-system/primitives";

import { TwoStepVerificationSection } from "../../../features/two-step-verification/ui/sections/two-step-verification-section.tsx";
import { EmailAndLinkedAccountsSection } from "../email-and-linked-accounts-section.tsx";
import { EnterpriseCapabilitiesSection } from "../enterprise-capabilities-section.tsx";
import { PasskeysSection } from "../passkeys-section.tsx";
import { PasswordSection } from "../password-section.tsx";

export default function SecurityScreen() {
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Security</PageLayout.Heading>
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        <Text color="fg.muted">
          The ways you sign in, and how you would get back in if you lost one of them.
        </Text>

        <EmailAndLinkedAccountsSection />

        {/* Above the password, deliberately. The order of this page is an
          argument about what an account should be secured with, and putting the
          thing we would rather people used underneath the thing we would rather
          they stopped using makes the opposite one. */}
        <PasskeysSection />

        <TwoStepVerificationSection />

        <PasswordSection />

        <EnterpriseCapabilitiesSection />
      </VStack>
    </>
  );
}
