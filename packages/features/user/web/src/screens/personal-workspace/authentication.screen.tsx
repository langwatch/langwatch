/**
 * The signed-in person's own sign-in methods, at `/settings/authentication`.
 *
 * AVAILABLE TO EVERY SIGNED-IN USER, no administrator gate — both the
 * governance / Personal-Workspace shells and the legacy `/[project]/` shell
 * reach this URL through the Settings navigation, and everything on it is
 * keyed on the reader's own account rather than on a scope. The platform page
 * carried no `withPermissionGuard` and neither does this key.
 *
 * One-SSO-per-organization is the typical enterprise shape, and the rendered
 * surface collapses to a status display in that case. Organization-wide single
 * sign-on is still provisioned through environment variables and IdP metadata
 * rather than here, so on a self-hosted deployment this page also carries the
 * DISCOVERY surface for it: otherwise an operator has no in-product route to
 * the setup guide at all.
 */

import { Heading, Text, VStack } from "@chakra-ui/react";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host";
import { EnterpriseCapabilitiesSection } from "../../ui/sections/enterprise-capabilities-section";
import { PasskeysSection } from "../../ui/sections/passkeys-section";
import { SignInMethodsSection } from "../../ui/sections/sign-in-methods-section";

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
