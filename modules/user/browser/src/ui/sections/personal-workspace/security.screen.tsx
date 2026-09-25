/**
 * Security settings page (/settings/security), renamed from Authentication
 * (now a redirect). Four bands: what "sam" is known by, the two proofs, the
 * password.
 */

import { Heading, Text, VStack } from "@chakra-ui/react";

import { TwoStepVerificationSection } from "../../../features/two-step-verification/ui/sections/two-step-verification-section.tsx";
import { usePersonalWorkspaceHost } from "../../../model/personal-workspace-host.ts";
import { EmailAndLinkedAccountsSection } from "../email-and-linked-accounts-section.tsx";
import { EnterpriseCapabilitiesSection } from "../enterprise-capabilities-section.tsx";
import { PasskeysSection } from "../passkeys-section.tsx";
import { PasswordSection } from "../password-section.tsx";

export default function SecurityScreen() {
  const host = usePersonalWorkspaceHost();
  const email = host.currentUser()?.email;

  return (
    <VStack gap={6} width="full" align="start">
      <VStack align="start" gap={1}>
        <Heading as="h2">Security</Heading>
        {email && <Text color="fg.muted">({email})</Text>}
      </VStack>

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
  );
}
