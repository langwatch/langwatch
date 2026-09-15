/**
 * Authentication settings page (/settings/authentication).
 * Shows user's sign-in methods; SSO discovery on self-hosted deployments.
 */

import { Heading, Text, VStack } from "@chakra-ui/react";
import { usePersonalWorkspaceHost } from "../../../model/personal-workspace-host.ts";
import { EnterpriseCapabilitiesSection } from "../enterprise-capabilities-section.tsx";
import { PasskeysSection } from "../passkeys-section.tsx";
import { SignInMethodsSection } from "../sign-in-methods-section.tsx";

export default function AuthenticationScreen() {
  const host = usePersonalWorkspaceHost();
  const email = host.currentUser()?.email;

  return (
    <VStack gap={6} width="full" align="start">
      <VStack align="start" gap={1}>
        <Heading as="h2">Sign-in Methods</Heading>
        {email && <Text color="fg.muted">({email})</Text>}
      </VStack>

      {/* Above the password, deliberately. The order of this page is an
          argument about what an account should be secured with, and putting the
          thing we would rather people used underneath the thing we would rather
          they stopped using makes the opposite one. */}
      <PasskeysSection />

      <SignInMethodsSection />

      <EnterpriseCapabilitiesSection />
    </VStack>
  );
}
