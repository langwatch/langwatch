import { Heading, Text, VStack } from "@chakra-ui/react";

import { SignInMethodsSection } from "../../components/me/SignInMethodsSection";
import SettingsLayout from "../../components/SettingsLayout";
import { EnterpriseCapabilitiesSection } from "../../components/settings/EnterpriseCapabilitiesSection";
import { useSession } from "../../utils/auth-client";

/**
 * Per-user sign-in methods. Available to every signed-in user (no admin
 * gate) — both governance/Personal-Workspace shells and the legacy
 * /[project]/ shell hit this URL through the Settings nav.
 *
 * One-SSO-per-org is the typical enterprise shape; the rendered surface
 * collapses to a status display in that case (see SignInMethodsSection).
 * Org-wide SSO is still provisioned through env vars / IdP metadata rather
 * than here, so on self-hosted this page also carries the discovery surface
 * for it (see EnterpriseCapabilitiesSection): otherwise an operator has no
 * in-product route to the setup guide at all.
 */
export default function AuthenticationSettings() {
  const { data: session } = useSession();

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <VStack align="start" gap={1}>
          <Heading as="h2">Sign-in Methods</Heading>
          {session?.user?.email && (
            <Text color="fg.muted">({session.user.email})</Text>
          )}
        </VStack>

        <SignInMethodsSection />

        <EnterpriseCapabilitiesSection />
      </VStack>
    </SettingsLayout>
  );
}
